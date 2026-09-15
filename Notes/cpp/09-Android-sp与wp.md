# Android sp 与 wp：先学会正确持有对象

`android::sp<T>` 和 `android::wp<T>` 是 AOSP Native 常见的强、弱引用句柄。使用时先记住一句话：`sp` 保活，`wp` 不保活；要使用弱引用目标，必须先 `promote()` 成一份临时强引用。

## 1. 它们和 shared_ptr 不是一套系统

`std::shared_ptr` 把计数和删除器放在控制块中，普通类型也能使用。`sp<T>` 要求 `T` 参与 Android 的侵入式引用计数协议，通常继承 `android::RefBase`。同一个裸指针不能同时交给两套所有权系统管理。

```cpp
class Job : public android::RefBase {};

android::sp<Job> job = android::sp<Job>::make();
android::wp<Job> observer = job;
```

现代 AOSP 代码优先使用 `sp<T>::make(...)`，不要把 `new`、手工 `incStrong()` 当成日常入口。

## 2. 复制、移动和 clear

```cpp
android::sp<Job> first = android::sp<Job>::make();
android::sp<Job> second = first;          // 新增一份强持有
android::sp<Job> third = std::move(second); // 转移句柄，second 变空
first.clear();                   // first 放弃自己的强持有
```

`clear()` 可能释放最后一份强引用并同步触发析构。因此不要默认它只是“把指针设为 null”，尤其不要在持锁时忽略析构可能产生的回调。

## 3. wp 使用前必须 promote

```cpp
android::wp<Job> weak = strong;
if (android::sp<Job> job = weak.promote()) {
    job->run();
} else {
    // 目标已不能取得强引用
}
```

`promote()` 把“检查目标还活着”和“增加强引用”作为一个协议操作。先取裸指针、检查非空、再手工加引用会留下竞态窗口。

## 4. AOSP 内可运行示例

```cpp title="android_sp_demo.cpp"
#include <utils/RefBase.h>
#include <utils/StrongPointer.h>

#include <iostream>

class Job : public android::RefBase {
public:
    explicit Job(int id) : id_(id) {
        std::cout << "create " << id_ << '\n';
    }

    void run() const { std::cout << "run " << id_ << '\n'; }

protected:
    ~Job() override { std::cout << "destroy " << id_ << '\n'; }

private:
    int id_;
};

int main() {
    android::sp<Job> owner = android::sp<Job>::make(7);
    android::wp<Job> observer = owner;

    {
        android::sp<Job> copy = owner;
        copy->run();
    }

    owner.clear();
    std::cout << (observer.promote() ? "alive" : "expired") << '\n';
}
```

```bp title="Android.bp"
cc_test {
    name: "cpp_notes_android_sp_demo",
    srcs: ["android_sp_demo.cpp"],
    shared_libs: ["libutils"],
    cpp_std: "c++17",
}
```

在 AOSP 根目录执行 `m cpp_notes_android_sp_demo`。运行时可以看到创建、调用、最后一份 `sp` 清除后析构，以及弱引用提升失败。

## 5. 接口签名怎么翻译成所有权

| 写法 | 通常表达 |
| --- | --- |
| `const sp<T>&` | 临时借用强指针包装；实现仍可能复制保存 |
| `sp<T>` | 当前调用持有一份强引用值 |
| `wp<T>` | 只观察，不保证目标存活 |
| `T*` | 仅凭签名无法知道谁保活，必须查调用上下文 |

本篇先讲使用规则；第 26 篇再沿 `incStrong`、`decStrong` 和弱计数结构解释 `RefBase` 的实现。源码入口见 [StrongPointer.h](https://android.googlesource.com/platform/system/core/+/refs/tags/android-16.0.0_r4/libutils/binder/include/utils/StrongPointer.h) 与 [RefBase.h](https://android.googlesource.com/platform/system/core/+/refs/tags/android-16.0.0_r4/libutils/binder/include/utils/RefBase.h)。
