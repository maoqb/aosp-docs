# Android RefBase、sp 与 wp

当天目标：读懂 AOSP 中最常见的对象生命周期表达方式。

- `sp<T>` 是 Android `RefBase` 体系的强引用，不等同于标准库 `shared_ptr`。
- `wp<T>` 是弱引用；提升为强引用前对象可能已经销毁。
- 先读 `RefBase` 的强弱引用计数规则，再读使用它的类。
- 成员使用 `sp<>` 往往表示持有，参数使用裸指针/引用通常表示借用；仍需结合上下文判断。

练习：阅读 `RefBase.h`，画出 `sp<>` 复制、销毁和 `wp<>.promote()` 的对象关系图。
