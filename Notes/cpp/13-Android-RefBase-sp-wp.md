# Android RefBase、sp 与 wp

`RefBase`、`sp<>`、`wp<>` 是 Android Native 最常见的引用计数体系。它与 `std::shared_ptr` 相似但不等价，理解它是阅读 Binder、Surface 和系统服务对象图的前提。

## 强弱引用模型

继承 `RefBase` 的对象可被 `sp<T>` 强引用持有。最后一个强引用释放时，对象通常析构；`wp<T>` 弱引用不保持对象存活，用于观察对象或打破环。弱引用提升为 `sp<T>` 可能失败，调用方必须处理失败。

```cpp
sp<Foo> strong = new Foo();
wp<Foo> weak = strong;
sp<Foo> again = weak.promote(); // 对象仍存活时才成功
```

## 生命周期钩子

`RefBase` 提供 `onFirstRef`、`onLastStrongRef` 等钩子，常被用来延迟启动或停止资源。读代码时不要把它们当普通析构替代品：对象具体何时析构仍取决于强弱引用及实现策略。

## 所有权阅读方法

成员 `sp<>` 通常是持有关系，`wp<>` 通常是非循环观察关系，参数 `sp<>` 会临时增加强引用。画对象图时标出每条强边和弱边；如果两个对象互相以 `sp<>` 持有，就要警惕泄漏环。

## 与标准库的区别

不要把 `sp<>` 和 `shared_ptr` 混用管理同一个原始对象，更不能从 `RefBase*` 擅自构造标准智能指针。它们有不同控制块和销毁规则。Android 代码中 `sp<T> foo = new T` 是既有惯例；新代码仍应遵循所在目录的风格和类型约束。

## 阅读入口

优先阅读 `system/core/libutils/include/utils/RefBase.h`，再配合实现文件追踪强弱引用计数。随后在 Binder 或 GUI 类中搜索 `onFirstRef`、`wp<>.promote()`，把引用变化与线程/回调时机一起记录。
