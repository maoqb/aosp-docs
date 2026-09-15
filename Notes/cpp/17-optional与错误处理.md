# optional 与错误处理

一个错误处理接口需要说明三件事：什么失败了，失败后对象处于什么状态，调用者还能做什么。日志只能帮助观察，不能代替这份契约。Native 崩溃也常是早先错误被忽略后的最终表现，而非出错的起点。

本篇先说明 `std::optional` 适合什么，再设计可运行的结果类型，并说明状态码、`errno`、异常与 Sanitizer 如何配合定位问题。

## 0. optional 只表达“有值或无值”

`std::optional<T>` 内部要么保存一个 `T`，要么为空。它适合“找不到不是错误”的查询；如果调用者必须知道为什么失败，应使用带错误信息的结果类型。

```cpp title="optional_demo.cpp"
#include <charconv>
#include <iostream>
#include <optional>
#include <string_view>

std::optional<int> parsePort(std::string_view text) {
    int port = 0;
    const auto result = std::from_chars(text.data(), text.data() + text.size(), port);
    if (result.ec != std::errc{} || result.ptr != text.data() + text.size() ||
        port < 1 || port > 65535) {
        return std::nullopt;
    }
    return port;
}

int main() {
    if (auto port = parsePort("8080")) {
        std::cout << *port << '\n';
    }
    std::cout << parsePort("bad").value_or(80) << '\n';
}
```

```bash
g++ -std=c++17 -Wall -Wextra -Wpedantic optional_demo.cpp -o optional_demo
./optional_demo
```

输出 `8080` 和 `80`。`if (auto port = ...)` 同时保存结果并检查是否有值，`*port` 只应在有值后使用；`value_or` 提供缺省值，但不要用缺省值掩盖本应上报的错误。

## 1. 先分类，才知道该返回还是终止

| 问题 | 例子 | 合理处理方向 |
| --- | --- | --- |
| 可恢复输入错误 | 非法宽度、格式不合法 | 向调用者返回明确错误 |
| 环境失败 | open 失败、服务尚未注册 | 根据业务重试、降级或上报 |
| 外部依赖失败 | 文件不存在、连接断开 | 根据业务重试、降级或上报 |
| 编程不变量被破坏 | 队列状态不可能组合 | 诊断并修复状态机 |
| 内存安全错误 | use-after-free、越界 | 修复所有权或边界，不应带病继续 |

一个外部请求传负数并不自动意味着应该 assert；assert 通常用于内部推理必须成立的条件。发布构建可能禁用普通 assert，不能依赖其副作用完成初始化或校验。

## 2. 返回值要让错误难以被忽略

仅返回 int 有时含糊：负数是错误码，还是合法业务值？返回 bool 又可能丢失失败原因。std::optional 适合只有“有值/无值”的情形；需要解释失败时，可以用带错误分支的结果类型。

Android libbase 的 Result 是常见平台方案。标准库 std::expected 到 C++23 才有，本系列 C++17 示例用 variant 展示同样的成功/失败分离思想。

## 3. 完整示例：解析显示宽度并保留错误类别

```cpp title="parse_result.cpp"
#include <charconv>
#include <iostream>
#include <string_view>
#include <system_error>
#include <variant>

enum class ParseError {
    InvalidSyntax,
    OutOfRange
};

using WidthResult = std::variant<int, ParseError>;

[[nodiscard]] WidthResult parseWidth(std::string_view text) {
    if (text.empty()) {
        return ParseError::InvalidSyntax;
    }

    int width = 0;
    auto parsed = std::from_chars(text.data(), text.data() + text.size(), width);

    if (parsed.ec == std::errc::result_out_of_range) {
        return ParseError::OutOfRange;
    }
    if (parsed.ec != std::errc{} || parsed.ptr != text.data() + text.size()) {
        return ParseError::InvalidSyntax;
    }
    if (width <= 0 || width > 16384) {
        return ParseError::OutOfRange;
    }
    return width;
}

int main() {
    for (std::string_view input : {"1080", "12px", "0"}) {
        WidthResult result = parseWidth(input);
        if (auto width = std::get_if<int>(&result)) {
            std::cout << "width=" << *width << '\n';
        } else if (std::get<ParseError>(result) == ParseError::InvalidSyntax) {
            std::cout << "invalid syntax\n";
        } else {
            std::cout << "out of range\n";
        }
    }
}
```

```bash
g++ -std=c++17 -Wall -Wextra -Wpedantic parse_result.cpp -o parse_result
./parse_result
```

输出：

```text
width=1080
invalid syntax
out of range
```

16384 是教学接口选定的限制，不是 Android 设备的统一显示上限。示例将字符格式、数值范围、业务范围分别检查；成功结果里只存在合法宽度。

nodiscard 鼓励调用者处理返回值，但通常是诊断提示，不是任何环境下都强制报错。真正的可靠性来自接口设计、调用点检查和编译规则共同作用。

## 4. errno 只能在失败后按接口约定读

系统调用常以 -1 表示失败，并在线程局部的 errno 中给出原因。errno 不会在每次成功调用时自动清零，也不能脱离返回值单独判断“上次调用是否失败”。

正确顺序是：

```text
调用系统接口 → 检查返回值 → 立即保存 errno → 清理/记录 → 返回对应失败
```

如果失败后先做若干清理、格式化和其他系统调用，再读取 errno，得到的可能已不是原失败。还要注意 POSIX 线程接口有些直接返回错误号，不采用 -1 加 errno，必须读具体契约。

EINTR 的处理也依接口而定：read/write 可能有重试和部分完成逻辑；Linux close 不能机械地按同一数字重试。不能用一个统一 while 宏包住所有系统调用。

## 5. 不同错误通道不要混成一个 int

| 层次 | 常见类型 | 说明 |
| --- | --- | --- |
| 平台底层状态 | status_t | 常见 OK/BAD_VALUE 等；具体定义以接口为准 |
| libbase 业务结果 | android::base::Result<T> | 成功值或可解释的错误信息 |
| POSIX 系统调用 | 返回值和 `errno` | 先检查失败返回，再及时保存 `errno` |
| C++ 异常 | 异常类型和消息 | 只在构建及接口契约允许时使用 |

错误表示必须跟随接口契约。不要把 `errno`、负业务值和枚举错误码全部塞进一个整数后靠调用者猜，也不要在底层已经记录日志后丢掉错误语义继续运行。

## 6. 异常安全的三个常见层次

不抛保证表示操作不会抛出异常；强保证表示失败时对外观察状态不变；基本保证表示失败后不泄漏且不变量仍成立，但内容可能变化。

例如容器追加时先申请新存储、完成元素构造，再提交状态切换，就是为了尽可能提供更强保证。把成员清空后再做可能失败的工作，通常难以维持“失败不变”。

Android 平台模块是否启用 C++ 异常和 RTTI 由构建决定，不能在未知模块直接加入 `throw`。跨 C ABI 时也不能让 C++ 异常随意逃逸，应在边界捕获并转换为明确的返回状态。

## 7. Sanitizer 如何定位第一次非法访问

ASan 在编译期插入访问检查，并用运行时跟踪可访问内存区。UBSan 检查一部分未定义行为，例如特定整数溢出、错误对齐。TSan 用于发现数据竞争，HWASan 则采用另一种内存标记方案。

这些工具覆盖的问题不相同；无报告也不等于程序被证明正确。只会在被执行到、且该工具支持的路径上产生证据。

在主机上常用：

```bash
g++ -std=c++17 -O1 -g -fno-omit-frame-pointer \
    -fsanitize=address,undefined use_after_free.cpp -o use_after_free
./use_after_free
```

这些命令针对下一节刻意出错的独立程序。不要将它放进服务实际运行路径。

## 8. 一个故意制造 use-after-free 的完整反例

```cpp title="use_after_free.cpp"
#include <iostream>
#include <memory>

int main() {
    auto owner = std::make_unique<int>(42);
    int* borrowed = owner.get();
    owner.reset();
    std::cout << *borrowed << '\n';
}
```

正常的验证结果是进程失败，ASan 报 heap-use-after-free；不要期待它稳定打印 42。未定义行为可以表现为旧值、随机值、崩溃或被优化成别的结果。

报告通常给出三段栈：非法读取位置、释放位置、最初分配位置。三者组合起来可重建：

```text
make_unique 分配 → get 建立借用 → reset 提前释放 → 借用被继续使用
```

给 borrowed 加非空检查无法解决，因为地址仍非空。修复应延长 owner 的寿命，或在释放前复制所需值；只有业务确实存在共享所有权时，才考虑共享句柄。

ASan 支持范围与构建参数参见 [Clang AddressSanitizer 文档](https://clang.llvm.org/docs/AddressSanitizer.html)。

## 9. Native tombstone 的阅读顺序

先确定崩溃进程、线程、signal 和 fault address，再核对每一帧所属库、PC 偏移、Build ID 和符号文件。符号必须匹配设备上那一份二进制，不能拿“同名库的另一个构建”硬解地址。

下面只是诊断信息的示意字段，不是真实事故记录：

```text
signal: SIGSEGV
thread: worker-2
frame #00: libexample.so + relative_pc
build id: must match unstripped binary
```

ndk-stack、llvm-symbolizer、addr2line 可帮助解析，但要分清工具输入要求是模块相对地址、文件内偏移还是运行时绝对地址；ASLR 会影响后者。编译优化还可能内联函数，栈与源码函数数量不一定一一对应。

确认最后访问在哪，只是定位症状。随后仍需追踪对象什么时候创建、何处释放、哪个线程修改过成员。

## 10. 日志如何提供证据而不掩盖错误

一条有效错误日志应该关联操作、对象身份或请求 ID、错误类别和必要状态。不要只打印“failed”，也不要在每层无差别重复同一错误造成噪声。

如果底层返回失败，上层应决定恢复策略；如果上层选择降级，应保留失败语义。日志后继续用未初始化输出参数，往往把易理解的错误变成稍后的崩溃。

图形路径中的高频日志还可能改变时序和性能。追帧时可优先使用受控 trace、计数和采样，避免日志本身制造卡顿。

## 11. Android 实现依据

平台 Result 的类型与错误辅助逻辑可读 [Android 16 result.h](https://android.googlesource.com/platform/system/libbase/+/refs/tags/android-16.0.0_r4/include/android-base/result.h)。实际调试时，首先建立可复现条件和匹配符号，再使用工具验证所有权或并发假设。
