# RAII 与资源管理

在 Native 程序里，最危险的资源泄漏常出现在不显眼的提前返回路径：打开 fd 后参数校验失败，加锁后某个分支直接返回，映射内存后下一步初始化失败。RAII 把清理责任绑定到对象析构，使控制流变化不必处处复制清理代码。

本篇先构建一个可运行的 fd 所有者，再分析锁、异常安全以及 Android 的 unique_fd。

## 1. 资源首先是一份责任

资源可能是内存，也可能是文件描述符、映射区、锁、EGL 句柄或者临时注册关系。它们的共同点是：成功获取后，必须存在一个明确的释放责任。

一个 int 可以保存 fd 数字，却没有携带责任。`int copy = descriptor;` 复制的只是数字，不会创建一个独立内核文件句柄，也不会自动关闭任何东西。

RAII 对象则同时持有资源标识和清理行为。正常作用域退出时，C++ 调用其析构函数；析构执行释放。从而每次成功获取都有一条结构化的退出路径。

## 2. 和 Java try-with-resources 的对应关系

Java 的 AutoCloseable 依赖显式 try-with-resources 块调用 close；C++ 常让所有者局部对象的析构完成等价动作。

区别在于 C++ 的普通对象、成员和容器都可以参与确定析构，所以资源所有者可以自然地嵌套。一个 Session 含一个 UniqueFd，Session 正常销毁时，它的成员也销毁。

GC 回收对象和释放操作系统资源是不同问题。Java 和 C++ 都需要避免把“对象暂时仍存在”误当作“资源仍可使用”；对象可以提前 close/reset，进入空状态。

## 3. 完整示例：Linux 上的独占 fd 类型

下面的 UniqueFd 是用于解释所有权的教学实现；Android 平台实际代码优先复用 android::base::unique_fd。该示例明确面向 Linux/Android 的 fd 行为。

```cpp title="unique_fd_demo.cpp"
#include <cerrno>
#include <fcntl.h>
#include <iostream>
#include <unistd.h>
#include <utility>

class UniqueFd {
public:
    explicit UniqueFd(int descriptor = -1) noexcept
        : descriptor_(descriptor) {}

    ~UniqueFd() noexcept {
        reset();
    }

    UniqueFd(const UniqueFd&) = delete;
    UniqueFd& operator=(const UniqueFd&) = delete;

    UniqueFd(UniqueFd&& other) noexcept
        : descriptor_(other.release()) {}

    UniqueFd& operator=(UniqueFd&& other) noexcept {
        if (this != &other) {
            reset(other.release());
        }
        return *this;
    }

    int get() const noexcept {
        return descriptor_;
    }

    explicit operator bool() const noexcept {
        return descriptor_ >= 0;
    }

    int release() noexcept {
        return std::exchange(descriptor_, -1);
    }

    void reset(int replacement = -1) noexcept {
        if (replacement == descriptor_) {
            return;
        }
        int previous = std::exchange(descriptor_, replacement);
        if (previous >= 0) {
            int savedError = errno;
            ::close(previous);
            errno = savedError;
        }
    }

private:
    int descriptor_;
};

int main() {
    UniqueFd first(::open("/dev/null", O_RDONLY | O_CLOEXEC));
    if (!first) {
        std::cerr << "open failed\n";
        return 1;
    }

    int borrowed = first.get();
    UniqueFd second(std::move(first));

    std::cout << std::boolalpha;
    std::cout << "source empty: " << !first << '\n';
    std::cout << "same descriptor: " << (second.get() == borrowed) << '\n';

    second.reset();
    errno = 0;
    bool closed = ::fcntl(borrowed, F_GETFD) == -1 && errno == EBADF;
    std::cout << "closed: " << closed << '\n';
}
```

```bash
g++ -std=c++17 -Wall -Wextra -Wpedantic unique_fd_demo.cpp -o unique_fd_demo
./unique_fd_demo
```

输出：

```text
source empty: true
same descriptor: true
closed: true
```

验证 closed 的这段程序在单线程下运行，关闭与检测之间没有打开新 fd。真实多线程程序中，数字可能被内核快速复用，因此不能把这个检测写成生产环境的“fd 安全探针”。

## 4. 按所有权分析每个操作

构造函数接管传入 fd；调用者不能再把同一个 fd 交给另一个独占所有者。get() 返回借用数字，不放弃管理；release() 清空所有者并返回 fd，调用者必须接手；reset() 释放旧 fd，再建立新状态。

删除拷贝避免两个所有者拿着同一个 fd 数字并在析构时重复 close。移动则将责任交给目标，让源对象变为空状态。空对象仍可析构和再次接收资源。

如果需要另一个独立 fd 数字，应使用 dup 或相应系统调用，而不是复制 int。即便 dup 成功，两个描述符仍可能共享同一个 open file description，例如共享文件偏移；“两个数字”也不等于“两份完全独立的文件状态”。

## 5. 析构清理的几个边界

析构函数应不抛异常。异常展开期间再次抛出并逃离析构，可能导致 std::terminate。对于 close 这样的失败，析构通常无法合理地要求调用者重试；关键持久化操作应提供显式 flush/commit/close 接口，让错误可被检查。

Linux 上不能机械地在 close 返回 EINTR 后对同一个数字重试：描述符可能已经被释放并复用，重试可能关闭另一个资源。本篇教学实现只调用一次 close。跨平台库应依据目标系统的精确定义封装。

保存 errno 是为了让清理动作不覆盖调用方正在报告的错误上下文。它不意味着 close 一定成功，只是让“资源清理”和“原失败原因”互不干扰。

## 6. RAII 能覆盖哪些退出路径

普通 return、离开花括号、已启用 C++ 异常时的栈展开，都会析构已构造的自动对象。构造过程中若某个成员失败，先前已成功构造的成员也会清理。

但 abort、_exit、SIGKILL、进程崩溃不是正常栈展开；std::exit 也不会析构当前栈上全部自动对象。不能用 RAII 承诺外部系统一定收到注销消息，或未同步数据一定落盘。

资源协议有时还需要显式业务提交。析构释放 fd，不等于写入事务已经持久化；析构释放锁，也不等于对象状态从逻辑上正确。

## 7. 锁也是资源，但资源语义不同

```cpp
{
    std::lock_guard<std::mutex> guard(mutex_);
    state_ = nextState;
}
```

guard 构造获取锁，析构解锁。它管理的是锁持有关系，而不是销毁 mutex 本身。一个有名字的局部变量非常重要：如果创建一个无名字临时锁对象，它可能在表达式结束时马上析构，后面的访问根本没被保护。

`unique_lock` 可暂时 unlock、再 lock，也能被条件变量用于等待；`lock_guard` 则表达固定作用域。不要仅为“更灵活”而扩大锁作用域。

## 8. 为什么清理位置也是并发设计的一部分

将成员智能指针 reset 可能触发对象析构；析构可能调用其他服务、拿另一把锁、通知 listener。因此下面这种意图必须认真审查：

```text
持有服务锁 → reset 最后一个强引用 → 析构回调服务 → 再次申请服务锁
```

一种常见策略是先在锁内把旧所有者移动到局部变量、更新受保护状态，再在锁外让旧所有者析构。这里仍需保证业务状态已经完整切换；不能简单地把所有东西移到锁外。

RAII 让释放时机可预测，也要求你主动选择那个时机。

## 9. Android unique_fd 的源码阅读

Android 16 的实现位于：

`system/libbase/include/android-base/unique_fd.h`

读取时围绕 get、release、reset、移动构造与析构展开，观察 fd 关闭的封装和调试保护。不要因为所有者只是一个轻量包装就手工取出数字并 close；那会破坏它所维护的唯一责任。

真实工程还可能存在借用 fd 视图和复制句柄的辅助类型。遇到接口时先确认参数是借用、接管还是复制，尤其是跨进程传递时。

## 10. 把资源拆成三层就不容易误判

| 层次 | fd 示例 | 容易混淆的地方 |
| --- | --- | --- |
| C++ 所有者 | UniqueFd 变量 | 移动的是责任，不一定改变 fd 数字 |
| 进程中的资源标识 | int fd | 数字复制不增加拥有者协议 |
| 内核资源 | open file description | dup 可得到新数字但仍共享某些状态 |

同样的方法可用于图形 buffer、映射内存和线程句柄：先找真正的资源，再找标识，最后找负责释放标识的 C++ 对象。

实现依据可查 [Android 16 unique_fd.h](https://android.googlesource.com/platform/system/libbase/+/refs/tags/android-16.0.0_r4/include/android-base/unique_fd.h)。移动构造与资源责任转移见第 14 篇。
