# AIDL NDK 与系统服务：接口生成、所有权、注册和完整调用链

AIDL 的价值不是省掉几行 `Parcel` 代码，而是让通信双方共享一份接口定义，并由生成器落实参数映射、事务分发和错误协议。对 Java 开发者而言，最重要的变化是：Native 服务除了实现方法，还要显式理解 C++ 所有权、输出参数和进程线程池。

本文基于 **AOSP `android-16.0.0_r4`**，给出一个完整的计数器接口、服务端、客户端和 Soong 模块。它是 **AOSP 平台示例，不是普通 APK 可以直接注册系统服务的模板**；设备部署还需要产品和 SELinux 集成。

## 1. 先区分 AIDL 的 CPP 后端与 NDK 后端

二者都生成 C++，但使用的运行时和对象模型不同：

| 维度 | CPP 后端 | NDK 后端 |
| --- | --- | --- |
| 主要运行时 | 平台 `libbinder` | `libbinder_ndk` |
| 常见接口持有方式 | `android::sp<IFoo>` | `std::shared_ptr<IFoo>` |
| Binder 句柄包装 | `sp<IBinder>` | `ndk::SpAIBinder` |
| 方法状态 | `android::binder::Status` | `ndk::ScopedAStatus` |
| 常见服务基类 | 平台 `BnFoo` | `aidl::...::BnFoo` |
| 应用范围 | 平台内部 C++ 组件 | 使用 NDK Binder 接口的 Native 组件 |

NDK 后端不是“自动允许第三方应用调用任意系统服务”。运行时 API 稳定性、接口版本稳定性和调用权限是三件不同的事；服务管理的一些接口仍属于平台能力。后端差异可对照 [AIDL backends](https://source.android.com/docs/core/architecture/aidl/aidl-backends)。

## 2. 从接口契约开始，而不是先写实现类

示例约定一个非负计数值：

- 初始值为 `0`。
- `getValue()` 返回一次受锁保护的快照。
- `setValue(value)` 接受非负值；负数返回参数错误，不改变当前值。
- 每次方法调用独立完成；`get` 后再 `set` 不是一个原子读改写操作。

文件布局如下，目录中的包路径必须与 AIDL 声明一致：

```text
cpp_notes_counter/
├── Android.bp
├── aidl/org/example/notes/ICounter.aidl
├── counter_server.cpp
└── counter_client.cpp
```

```aidl title="aidl/org/example/notes/ICounter.aidl"
package org.example.notes;

interface ICounter {
    int getValue();
    void setValue(int value);
}
```

这里不加 `oneway`：客户端需要知道方法执行成功与否，尤其要接收负数校验失败。把 `setValue` 改成远程 `oneway`，意味着不能继续依赖同步方法状态来报告执行结果。

## 3. Java 返回值为何变成 C++ 输出指针

NDK 后端将 AIDL 的返回值与方法状态拆开。上面的接口生成的方法形态是：

```cpp
ndk::ScopedAStatus getValue(std::int32_t* result) override;
ndk::ScopedAStatus setValue(std::int32_t value) override;
```

`getValue` 的 C++ 函数返回值被用于传递 `ScopedAStatus`，原来的 AIDL `int` 通过输出参数交付。调用者必须先检查状态，再使用输出值。

`result` 是生成的调用约定提供的有效输出地址；服务实现不应将它保存到成员或异步任务。一次 Binder 方法返回后，这个地址对应的存储就不再是后续工作的契约。

这是 C++ 阅读中的一个实用规则：看到 `T*` 参数，不要立刻判断“拥有一个堆对象”；这里它表达的是 **同步调用期间借用的一块输出存储**。

## 4. 服务端：状态保护、业务错误与注册

```cpp title="counter_server.cpp"
#include <aidl/org/example/notes/BnCounter.h>
#include <android/binder_manager.h>
#include <android/binder_process.h>

#include <cstdint>
#include <iostream>
#include <mutex>
#include <string>

using aidl::org::example::notes::BnCounter;
using aidl::org::example::notes::ICounter;

class Counter final : public BnCounter {
public:
    ndk::ScopedAStatus getValue(std::int32_t* result) override {
        std::lock_guard<std::mutex> guard(mutex_);
        *result = value_;
        return ndk::ScopedAStatus::ok();
    }

    ndk::ScopedAStatus setValue(std::int32_t value) override {
        if (value < 0) {
            return ndk::ScopedAStatus::fromExceptionCodeWithMessage(
                EX_ILLEGAL_ARGUMENT, "value must be non-negative");
        }

        std::lock_guard<std::mutex> guard(mutex_);
        value_ = value;
        return ndk::ScopedAStatus::ok();
    }

private:
    std::mutex mutex_;
    std::int32_t value_ = 0;
};

int main() {
    if (!ABinderProcess_setThreadPoolMaxThreadCount(2)) {
        std::cerr << "thread pool configuration failed\n";
        return 1;
    }

    auto service = ndk::SharedRefBase::make<Counter>();
    const std::string instance =
            std::string(ICounter::descriptor) + "/default";

    const binder_exception_t status = AServiceManager_addService(
            service->asBinder().get(), instance.c_str());
    if (status != EX_NONE) {
        std::cerr << "addService failed: " << status << '\n';
        return 1;
    }

    ABinderProcess_startThreadPool();
    std::cout << "registered " << instance << std::endl;
    ABinderProcess_joinThreadPool();
    return 0;
}
```

`setValue` 的范围检查不访问共享成员，因此可以放在锁外；真正的状态修改和读取使用同一把锁。多个 Binder 线程同时进入时，不会对 `value_` 形成数据竞争。

这个版本的 `AServiceManager_addService` 返回 `binder_exception_t`，成功值为 `EX_NONE`；不要仅因为底层都是整数，就把注册结果、传输状态和方法的 `ScopedAStatus` 混为同一种错误协议。

这里故意不提供“读取后加一再写回”的客户端功能。如果两个客户端都读取 `10`，再分别设置 `11`，最终仍是 `11`，而不是 `12`。消除数据竞争不等于保证跨多个 RPC 的业务事务性；需要原子递增时，应把 `increment` 设计为单个服务方法，在服务端一次锁定中完成。

## 5. SharedRefBase::make 不能随意换成 make_shared

`BnCounter` 继承 NDK Binder 的共享对象基础。它需要建立与其内部 `ref()` 协议一致的 `shared_ptr` 控制块，推荐创建入口是：

```cpp
auto service = ndk::SharedRefBase::make<Counter>();
```

不要把上一章的 `android::sp<Counter>::make()` 套进来，也不要随意用 `std::make_shared<Counter>()`、栈对象或 `std::shared_ptr<Counter>(raw)` 代替。后者可能绕开或破坏 `SharedRefBase` 的内部所有权关系。

这里有两个不同层次的持有者：

- `std::shared_ptr<Counter>` 管理 C++ 服务实现对象。
- `ndk::SpAIBinder` 管理 NDK Binder 引用。

`asBinder()` 在两者之间提供约定好的桥接；`get()` 只是为 C API 借出裸 `AIBinder*`。不要另起一个管理器对这个借用地址独立释放。

## 6. 客户端：先确认服务，再逐次检查状态

```cpp title="counter_client.cpp"
#include <aidl/org/example/notes/ICounter.h>
#include <android/binder_manager.h>

#include <cstdint>
#include <iostream>
#include <string>

using aidl::org::example::notes::ICounter;

int main() {
    const std::string instance =
            std::string(ICounter::descriptor) + "/default";
    ndk::SpAIBinder binder(AServiceManager_checkService(instance.c_str()));
    if (binder.get() == nullptr) {
        std::cerr << "service unavailable\n";
        return 1;
    }

    auto service = ICounter::fromBinder(binder);
    if (service == nullptr) {
        std::cerr << "interface mismatch\n";
        return 1;
    }

    auto status = service->setValue(42);
    if (!status.isOk()) {
        std::cerr << status.getDescription() << '\n';
        return 1;
    }

    std::int32_t value = 0;
    status = service->getValue(&value);
    if (!status.isOk()) {
        std::cerr << status.getDescription() << '\n';
        return 1;
    }
    std::cout << "value=" << value << '\n';

    status = service->setValue(-1);
    if (status.isOk() ||
        status.getExceptionCode() != EX_ILLEGAL_ARGUMENT) {
        std::cerr << "unexpected result for negative value\n";
        return 1;
    }
    std::cout << "negative value rejected\n";

    status = service->getValue(&value);
    if (!status.isOk()) {
        std::cerr << status.getDescription() << '\n';
        return 1;
    }
    std::cout << "value after rejection=" << value << '\n';
}
```

服务已注册且没有其他客户端修改状态时，输出应为：

```text
value=42
negative value rejected
value after rejection=42
```

`checkService` 适合这个“服务未运行就明确退出”的实验。若使用 `waitForService`，需要理解它的等待行为以及启动依赖：服务永远不出现时，客户端可能一直等下去。不要在界面主线程上无条件等待系统服务。

即使查找和接口转换成功，后面的每次调用仍可能遇到对端死亡。服务可用不是一次检查之后永久成立的条件。

## 7. Soong：让接口模块生成 NDK 库

```bp title="Android.bp"
aidl_interface {
    name: "cpp-notes-counter",
    srcs: ["aidl/org/example/notes/ICounter.aidl"],
    local_include_dir: "aidl",
    unstable: true,
    backend: {
        java: {
            enabled: false,
        },
        cpp: {
            enabled: false,
        },
        ndk: {
            enabled: true,
        },
        rust: {
            enabled: false,
        },
    },
}

cc_binary {
    name: "cpp_notes_counter_service",
    srcs: ["counter_server.cpp"],
    shared_libs: [
        "libbinder_ndk",
        "cpp-notes-counter-ndk",
    ],
    cpp_std: "c++17",
}

cc_binary {
    name: "cpp_notes_counter_client",
    srcs: ["counter_client.cpp"],
    shared_libs: [
        "libbinder_ndk",
        "cpp-notes-counter-ndk",
    ],
    cpp_std: "c++17",
}
```

在已经执行产品 `lunch`、目录纳入 Soong 扫描的 AOSP 环境中，可构建：

```bash
m cpp_notes_counter_service cpp_notes_counter_client
```

示例选择 `unstable: true`，因此没有接口冻结目录，也不使用 `-V1-ndk` 一类版本库名。这个选择是为了隔离“第一次读通生成链”的复杂度，**不是跨 system / vendor 生产接口的建议配置**。

常见的头文件找不到问题，应该检查生成模块依赖与包路径，而不是将生成目录硬编码进业务源码。生成物通常位于 `out/soong/.intermediates/` 下，业务模块通过依赖获得正确的头文件导出。

## 8. 注册成功之前，还有产品和安全边界

把二进制编译出来不等于已经拥有系统服务：

| 集成层 | 需要解决的问题 |
| --- | --- |
| 产品打包 | 服务、客户端和生成的依赖库是否进入正确分区 |
| 启动方式 | 手动实验还是 init 管理，进程以什么身份运行 |
| SELinux 域 | 可执行文件标签、域转换、Binder 调用权限 |
| 服务名称映射 | 服务名如何映射到 `service_contexts` 中的类型 |
| 注册与查找权限 | 哪个域可以 `add`，哪些域可以 `find` |
| 业务授权 | 哪些调用者可以读、写计数值 |

示例中的服务只演示参数校验和并发保护，**没有实现生产级调用授权**。它不应直接暴露给任意不可信调用者。

也不要通过关闭 SELinux 或给所有域放开权限来“完成教程”。应在你控制的测试产品中按已有服务的最小权限模式集成。由于产品目录、域和分区安排各不相同，这里不提供会误导读者直接复制的通用放权规则。

## 9. 不启动服务，也能先看懂生成代码

有 AOSP 编译出的 `aidl` 工具时，在示例目录可执行：

```bash
aidl --lang=ndk --structured \
  -I aidl --out=generated --header_out=generated/include \
  aidl/org/example/notes/ICounter.aidl
```

重点查看：

```text
generated/include/aidl/org/example/notes/ICounter.h
generated/include/aidl/org/example/notes/BnCounter.h
generated/include/aidl/org/example/notes/BpCounter.h
generated/org/example/notes/ICounter.cpp
```

从 `setValue` 追踪时，不必逐字阅读所有模板辅助代码，先抓住四段：

1. `BpCounter::setValue` 准备事务并写入 `int32`。
2. 代理提交 Binder 事务，检查框架层返回值。
3. 服务端事务分发函数读取参数，调用真正的 `Counter::setValue`。
4. 服务端写入方法状态；客户端读取状态并返回 `ScopedAStatus`。

`getValue` 还多出一步：只有方法状态允许时，才写出并读回输出参数。生成代码能直观解释为什么客户端不能先使用 `value` 再检查 `isOk()`。

手工生成适合研究和核对，不意味着把生成代码复制进仓库长期维护。正常构建应让接口定义驱动生成。

## 10. 三种“稳定”不能混为一谈

**运行时 API 稳定**：NDK Binder 暴露的运行时接口有其兼容性契约，但平台专属能力仍受环境约束。

**AIDL 接口版本稳定**：接口经过 API 快照、冻结与兼容性管理，更新时不能任意重排、删除或改变已有语义。即使构建检查允许某种字段扩展，业务也要考虑旧端看到缺省值时的行为。

**VINTF 稳定性**：跨越相应系统 / 厂商边界的接口，还涉及稳定性声明、设备清单、兼容性矩阵和具体版本依赖。并不是加一个 `stability: "vintf"` 就完成整个集成。

本篇示例没有声明 VINTF，也没有冻结版本。实际产品接口应按照 [Stable AIDL](https://source.android.com/docs/core/architecture/aidl/stable-aidl) 的流程演进，而不是把演示模块原样升级为 HAL。

## 11. 线程池数量与生命周期的两个陷阱

服务端示例先配置最大数量，再启动线程池，最后让主线程加入。这里的 `2` **不是“整个进程最多只有两条 Binder 线程”**。

在本篇版本的头文件契约中，配置值指可由内核按需启动的那部分线程；`startThreadPool` 启动的线程和调用 `joinThreadPool` 加入的当前线程另算。数量应按进程角色与调用负载设计，库不应私自配置整个应用的 Binder 线程池。

其次，示例没有退出协议，`joinThreadPool` 用于让服务进程持续处理事务。真实服务若需要停止，还要区分：

- 不再接受业务请求。
- 等待已经开始的任务完成。
- 注销监听者和释放外部资源。
- 进程何时退出、由谁重启。

C++ 对象析构并不能替代一个完整的系统服务生命周期设计。

## 12. 源码入口与排错顺序

- [binder_interface_utils.h](https://android.googlesource.com/platform/frameworks/native/+/refs/tags/android-16.0.0_r4/libs/binder/ndk/include_cpp/android/binder_interface_utils.h)：`SharedRefBase`、`ICInterface` 和服务端模板基础。
- [binder_auto_utils.h](https://android.googlesource.com/platform/frameworks/native/+/refs/tags/android-16.0.0_r4/libs/binder/ndk/include_cpp/android/binder_auto_utils.h)：`SpAIBinder`、`ScopedAStatus` 的 RAII 封装。
- [binder_manager.h](https://android.googlesource.com/platform/frameworks/native/+/refs/tags/android-16.0.0_r4/libs/binder/ndk/include_platform/android/binder_manager.h)：服务注册与查找契约。
- [binder_process.h](https://android.googlesource.com/platform/frameworks/native/+/refs/tags/android-16.0.0_r4/libs/binder/ndk/include_platform/android/binder_process.h)：线程池数量的精确定义。
- [AIDL NDK 生成代码样本](https://android.googlesource.com/platform/system/tools/aidl/+/refs/tags/android-16.0.0_r4/tests/golden_output/aidl-test-interface-ndk-source/gen/android/aidl/tests/ITestService.cpp)：对照代理、分发和状态编码。

遇到失败时按层排查：**构建依赖 → 进程是否运行 → 注册结果与 SELinux → 查找结果 → 接口转换 → 每次事务状态 → 业务状态**。不要把所有问题都归因于“Binder 没连上”。
