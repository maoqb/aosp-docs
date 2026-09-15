# vector 与连续容器

Android Native 中，经常需要用 string 保存名称、用 vector 保存图层、用 map 查找设备、再通过循环批量更新对象。代码很短，背后却同时涉及所有权、元素复制、引用失效、查找复杂度和锁的范围。

本篇以 C++17 为基准，用一个完整配置解析器串起 `string`、`vector`、范围 `for`、迭代器和失效规则；关联容器另见第 11 篇。

## 1. 字符串是字节序列，不是统一的“字符数组”

std::string 拥有一段 char 序列。它可以包含零字节，size() 返回元素数量，不自动按 UTF-8 字符、Unicode 码点或用户可见字形计数。

Java String 使用 UTF-16 代码单元模型；Android Native 中还会遇到 String16、String8、JNI Modified UTF-8。两个接口都叫 string，不意味着编码和长度单位相同。

```cpp
std::string value("ab\0cd", 5);
```

此时 size 为 5，而 strlen(value.c_str()) 只看到前两个字节。把含零数据交给依赖 C 风格终止符的接口，可能被截断。

c_str() 给出的借用指针受原字符串寿命和后续修改影响。它不会独立拥有内容，也不应交给未知时间才执行的回调。

## 2. string 与 string_view 的所有权区别

string_view 是 C++17 的非拥有字符串视图，可表达一段连续字符，不负责分配和释放。substr 通常只构造新视图，因此适合解析过程中切片。

| 类型 | 是否拥有字节 | 切片代价 | 长期保存条件 |
| --- | --- | --- | --- |
| std::string | 是 | 通常复制对应内容 | 对象自己负责寿命 |
| std::string_view | 否 | 通常常数时间 | 原字节仍存在且未失效 |
| const char* | 否 | 只有地址，无显式长度 | 还要满足接口的终止符约定 |

`std::string_view view = std::string("temporary");` 会在分号处留下悬空视图。若 map<string_view, Value> 的 key 来自临时输入缓冲区，map 自身仍活着也没用；它存的是借用。

## 3. vector 的 size、capacity 和连续存储

size 是已构造元素数，capacity 是无需重新分配即可容纳的上限。reserve(100) 预留容量，并不会创建 100 个元素；resize(100) 才改变元素数并相应构造/销毁元素。

以下错误片段常见于“先 reserve 再直接下标写入”：

```cpp
std::vector<int> values;
values.reserve(10);
values[0] = 7;
```

size 仍为 0，访问索引 0 越界。正确选择是 push_back，或先 resize 再下标赋值。

vector 连续布局利于缓存和批量传递，但容量不足时通常重新分配并搬迁元素。这不是优化细节：它决定原元素地址是否还有效。

## 4. 失效规则不能只记一句“扩容会变”

| 操作 | vector 中常见后果 |
| --- | --- |
| push_back 导致重分配 | 原元素指针、引用、迭代器全部失效 |
| push_back 未重分配 | 原有元素引用一般保持，旧 end 失效 |
| erase 一个元素 | 该位置及之后的迭代器/引用失效 |
| clear | 全部元素销毁，即使 capacity 保留 |
| reserve 未增加容量 | 通常不改变原地址 |
| resize 缩小 | 被移除元素失效，保留元素仍需按规则使用 |

同样的规则不能搬到所有容器。map 节点插入通常不会使已有元素迭代器失效；unordered_map rehash 会使迭代器失效，但一般不使元素引用和指针失效。erase 则使被删元素本身失效。

阅读长期保存的 `&items[index]` 时，必须向后搜索所有结构性修改。

## 5. 范围 for 的 auto 到底推导了什么

```cpp
for (auto value : values) {}
for (auto& value : values) {}
for (const auto& value : values) {}
```

三者分别常见于按值复制、可写借用、只读借用。按值 auto 会去掉引用和顶层 const；是否复制真实对象还取决于元素类型。

如果元素是 shared_ptr，按值循环复制的是一个共享句柄，会增加强计数，不会深拷贝目标。如果元素是一个大结构体，可能复制整份结构体；如果元素是 unique_ptr，按值复制根本不允许。

C++17 结构化绑定也一样：

```cpp
for (const auto& [key, value] : mapping) {
    consume(key, value);
}
```

这是调用片段，consume 代表业务函数。去掉 & 可能复制每个键值对。

## 6. 完整示例：安全保存解析出来的配置

程序接受内置的 key=value 文本，临时用 string_view 切片，最终用 string 拥有 key，以避免配置离开输入缓冲区后悬空。整数解析采用 C++17 from_chars，明确检查整段是否消费完毕。

```cpp title="parse_config.cpp"
#include <charconv>
#include <iostream>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <system_error>

std::string_view trim(std::string_view text) {
    while (!text.empty() && (text.front() == ' ' || text.front() == '\t')) {
        text.remove_prefix(1);
    }
    while (!text.empty() && (text.back() == ' ' || text.back() == '\t'
                            || text.back() == '\r')) {
        text.remove_suffix(1);
    }
    return text;
}

std::optional<int> parseInteger(std::string_view text) {
    if (text.empty()) {
        return std::nullopt;
    }

    int value = 0;
    auto result = std::from_chars(text.data(), text.data() + text.size(), value);
    if (result.ec != std::errc{} || result.ptr != text.data() + text.size()) {
        return std::nullopt;
    }
    return value;
}

std::map<std::string, int> parseConfig(std::string_view input) {
    std::map<std::string, int> result;

    while (!input.empty()) {
        auto newline = input.find('\n');
        auto line = trim(input.substr(0, newline));

        if (newline == std::string_view::npos) {
            input = {};
        } else {
            input.remove_prefix(newline + 1);
        }

        auto separator = line.find('=');
        if (separator == std::string_view::npos) {
            continue;
        }

        auto key = trim(line.substr(0, separator));
        auto number = parseInteger(trim(line.substr(separator + 1)));
        if (key.empty() || !number) {
            continue;
        }

        result.insert_or_assign(std::string(key), *number);
    }

    return result;
}

int main() {
    std::map<std::string, int> settings;
    {
        std::string input = "width=1080\nheight=2400\nfps=60\nfps=90\nbad=12x\n";
        settings = parseConfig(input);
    }

    for (const auto& [key, value] : settings) {
        std::cout << key << '=' << value << '\n';
    }
}
```

```bash
g++ -std=c++17 -Wall -Wextra -Wpedantic parse_config.cpp -o parse_config
./parse_config
```

输出：

```text
fps=90
height=2400
width=1080
```

map 按 key 排序，因此输出稳定；重复 fps 使用 insert_or_assign 表达后值覆盖；12x 因未完整解析被拒绝。input 已在打印前销毁，但结果持有 string key，所以仍然有效。

这个解析器有明确范围：只处理简单行和十进制 int，不支持转义、注释或复杂配置语法。清楚界定边界，比把任何字符串都勉强解析为一个整数更可靠。

## 7. map 与 unordered_map 如何选择

map 通常提供 O(log N) 查找和有序遍历；unordered_map 平均查找接近 O(1)，但最坏情况及 rehash 成本不能忽略。对少量元素，连续 vector 的缓存局部性可能足够好，不能仅按复杂度符号做性能结论。

`mapping[key]` 对不存在的 key 会默认插入值；在只读查询路径中，这会偷偷改变状态，甚至需要写锁。find 不插入；C++20 起有 contains，本篇 C++17 示例使用 find 类接口。

hash 和 equality 必须一致：认为相等的 key 必须给出一致哈希。若 key 借用了会被外部修改的字节，即使内存仍存活，也可能破坏容器查找不变量。

## 8. 删除元素要处理迭代器推进

```cpp
for (auto iterator = values.begin(); iterator != values.end();) {
    if (*iterator < 0) {
        iterator = values.erase(iterator);
    } else {
        ++iterator;
    }
}
```

这是 vector<int> 上的删除片段。erase 返回可继续遍历的位置；先 erase 再无条件 ++ 可能跳过元素或使用已失效迭代器。

对于 vector 批量过滤，erase-remove 组合能减少反复搬迁；C++20 有 erase_if。选择写法应依据工程语言版本。

## 9. Android 中容器、所有权和锁相互独立

`vector<sp<Layer>>` 管理一批强句柄；`vector<Layer*>` 只管理地址值。容器本身不会从后者推断“要 delete Layer”。

一个 vector 成员受 mutex 保护时，不能在锁内找到元素引用，然后在锁外继续访问而忽略并发 erase 或扩容。可以在锁内复制一个合适的拥有句柄，让锁外对象寿命有保证；目标状态仍需要自己的同步。

这也解释了为什么“为了省复制把所有局部变量改 const&”不是通用优化：那可能删掉原来负责保活的强引用副本。

## 10. 规则依据

vector 失效与修改规则见 [vector.modifiers](https://eel.is/c++draft/vector.modifiers)；非拥有字符串视图见 [string.view](https://eel.is/c++draft/string.view)。对 Android 自有容器，应读取当前分支实现，不能直接假设与 STL 完全一致。
