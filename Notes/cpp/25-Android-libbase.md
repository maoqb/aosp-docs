# Android libbase：平台 Native 代码的常用基础工具

`libbase` 是 AOSP Native 代码常用的基础库，提供日志、结果类型、文件操作、属性读取、字符串辅助和 `unique_fd` 等工具。它不是 C++ 标准库的一部分，普通桌面项目不能只写 `#include <android-base/...>` 就直接使用。

## 1. 日志：LOG 与 PLOG

```cpp
LOG(INFO) << "service started";
PLOG(ERROR) << "open failed";
```

`LOG` 使用流式接口；`PLOG` 还附带当前 `errno` 的文字说明，适合紧跟在约定设置 `errno` 的失败调用之后。`LOG(FATAL)` 会终止进程，不能拿来处理普通外部输入错误。

## 2. Result：成功值和错误不能同时存在

```cpp
android::base::Result<int> parseId(std::string_view text) {
    if (text.empty()) return android::base::Error() << "empty id";
    return 42;
}
```

调用者先检查 `ok()`，成功时解引用取值，失败时读取 `error()`。`ErrnoError()` 会保存 `errno`，要在失败发生后及时构造。

## 3. unique_fd：让 fd 跟随对象生命周期

```cpp
android::base::unique_fd fd(open(path, O_RDONLY | O_CLOEXEC));
if (fd < 0) return android::base::ErrnoError() << "open " << path;
```

`unique_fd` 析构时关闭 fd，可移动、不可复制。`get()` 只是借用数字，`release()` 则放弃自动关闭责任；两者不能混用。

## 4. AOSP 内完整示例

```cpp title="libbase_demo.cpp"
#include <android-base/logging.h>
#include <android-base/properties.h>
#include <android-base/result.h>
#include <android-base/unique_fd.h>

#include <fcntl.h>
#include <sys/stat.h>

#include <string>

android::base::Result<off_t> fileSize(const char* path) {
    android::base::unique_fd fd(open(path, O_RDONLY | O_CLOEXEC));
    if (fd < 0) return android::base::ErrnoError() << "open " << path;

    struct stat info {};
    if (fstat(fd.get(), &info) == -1) {
        return android::base::ErrnoError() << "fstat " << path;
    }
    return info.st_size;
}

int main(int argc, char* argv[]) {
    android::base::InitLogging(argv);
    const char* path = argc > 1 ? argv[1] : "/system/build.prop";

    auto size = fileSize(path);
    if (!size.ok()) {
        LOG(ERROR) << size.error();
        return 1;
    }

    const std::string model =
            android::base::GetProperty("ro.product.model", "unknown");
    LOG(INFO) << "model=" << model << " file-size=" << *size;
}
```

```bp title="Android.bp"
cc_binary {
    name: "cpp_notes_libbase_demo",
    srcs: ["libbase_demo.cpp"],
    shared_libs: ["libbase"],
    cpp_std: "c++17",
}
```

在 AOSP 根目录执行 `m cpp_notes_libbase_demo`。目标设备能否执行以及放入哪个分区，还取决于产品配置、SELinux 和模块安装属性；编译成功不代表自动进入镜像。

## 5. 常用头文件地图

| 需求 | 入口 |
| --- | --- |
| 日志 | `android-base/logging.h` |
| 成功/失败返回 | `android-base/result.h` |
| fd 所有权 | `android-base/unique_fd.h` |
| 文件整体读写 | `android-base/file.h` |
| 系统属性 | `android-base/properties.h` |
| 字符串拆分、拼接 | `android-base/strings.h` |
| 作用域退出回调 | `android-base/scopeguard.h` |

接口会随分支演进，阅读时以当前源码树为准。Android 16 的入口可从 [libbase include/android-base](https://android.googlesource.com/platform/system/libbase/+/refs/tags/android-16.0.0_r4/include/android-base/) 开始，`Result` 的设计与示例见同一版本的 [result.h](https://android.googlesource.com/platform/system/libbase/+/refs/tags/android-16.0.0_r4/include/android-base/result.h)。
