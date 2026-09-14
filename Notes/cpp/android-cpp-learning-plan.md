# Android C++ 学习计划

## 学习原则

- **以 Java 对照 C++**：每学一个概念，都回答它在 Java 中对应什么、C++ 多了什么风险。
- **先读小而完整的代码路径**：优先从 Binder、JNI 的调用链开始，避免一开始扎进 SurfaceFlinger 大类。
- **所有权优先于语法**：Android C++ 阅读中最重要的问题是“谁创建、谁持有、何时释放”。
- **边学边编译运行**：每个阶段都写可运行的小例子，再对照 AOSP 中的真实用法。

## 第一阶段：建立 C++ 基础心智模型（1～2 周）

重点是补足 Java 没有或语义不同的部分：

| C++ 概念 | 与 Java 的关键差异 | Android 源码中常见位置 |
| --- | --- | --- |
| 值、引用、指针 | 引用不是对象；指针可能为空且可表达所有权/借用 | 函数参数、回调、sp<T> |
| 栈与堆 | 栈上对象自动析构；堆对象需要明确生命周期 | RAII、临时锁、资源封装 |
| 构造与析构 | 构造/析构是确定性执行，不依赖 GC | 文件描述符、锁、Binder 资源 |
| const | 是接口约束与可读性工具，不只是常量 | 方法、参数、成员函数 |
| 拷贝与移动 | 复制可能昂贵或被禁止；移动会转移资源 | 容器、返回值、资源类 |

### 建议练习

1. 用 `std::string`、`std::vector` 写一个解析命令行参数的小程序。
2. 写一个 `FileHandle` 类，用析构函数自动关闭文件描述符，体会 RAII。
3. 分别传值、传 `const&`、传指针，实现同一个函数，并解释各自适用场景。
4. 用 AddressSanitizer 编译一个故意越界或悬空指针的例子，观察报错。

## 第二阶段：掌握所有权与 Android 智能指针（第 3～4 周）

这是阅读 Android Native 代码最优先的阶段。

| 类型 | 主要用途 | 阅读时要问的问题 |
| --- | --- | --- |
| std::unique_ptr<T> | 独占所有权 | 谁把所有权移交给谁？ |
| std::shared_ptr<T> / std::weak_ptr<T> | 标准库共享所有权 | 是否可能形成循环引用？ |
| android::sp<T> / android::wp<T> | Android RefBase 体系 | 强/弱引用何时增加、何时提升？ |
| 原始指针 T* | 非拥有借用或可空参数 | 生命周期由谁保证？是否可为 nullptr？ |
| 引用 T& / const T& | 必须存在的借用 | 调用期间对象是否有效？ |

### 必读源码

- `system/core/libutils/include/utils/RefBase.h`
- `system/core/libutils/RefBase.cpp`
- `frameworks/native/libs/binder/include/binder/RefBase.h`（不同分支路径可能略有差异）

### 建议练习

1. 用 `unique_ptr` 实现一个只能移动、不能复制的资源类。
2. 用 `shared_ptr` 故意构造循环引用，再用 `weak_ptr` 修复。
3. 阅读一个含 `sp<>` 成员的 AOSP 类，为每个成员标注“拥有 / 借用 / 缓存”。

## 第三阶段：语言特性够用即可（第 5～6 周）

按源码阅读价值排序学习：

1. 类继承、虚函数、抽象接口、`override`、`final`。
2. 模板、泛型容器、类型推导 `auto`、范围 `for`。
3. Lambda、`std::function` 与回调捕获方式。
4. 错误处理：返回状态值、`android::base::Result`、异常为何在 Android Native 中较少使用。
5. 并发基础：`std::mutex`、`std::lock_guard`、条件变量、原子变量。

不要过早投入复杂模板元编程。读到再查，比系统背诵更高效。

## 第四阶段：沿 Android 调用链读 C++（第 7～10 周）

### 路线 A：JNI（最适合 Java 开发者）

从 Java 的 `native` 方法出发，找到 JNI 注册、C++ 实现与结果返回：

```text
Java native 方法
  → JNI 注册表 / JNI_OnLoad
  → C++ 函数
  → Native 服务或库
  → Java 对象 / 异常 / 返回值
```

关注点：`JNIEnv*` 生命周期、局部/全局引用、字符串和数组转换、异常检查、线程 attach/detach。

### 路线 B：Binder（Android C++ 的核心）

先理解这组角色：

```text
客户端 Proxy（Bp） → Parcel → Binder 驱动 → 服务端 Stub（Bn） → 实现类
```

推荐按顺序阅读：

1. `frameworks/native/libs/binder/Parcel.cpp`
2. `frameworks/native/libs/binder/Binder.cpp`
3. 一个小型 AIDL 接口生成的 C++ 代码
4. `servicemanager` 的服务查询与注册流程

每次看到 `sp<IBinder>`、`status_t`、`Parcel` 或 `String16`，都记录它的输入、输出和所有权。

### 路线 C：图形与窗口（后续重点）

在熟悉 Binder 后，再进入：

- `frameworks/native/libs/gui/`：`SurfaceControl`、`BufferQueue`。
- `frameworks/native/services/surfaceflinger/`：合成与显示事务。
- `frameworks/base/services/core/jni/`：Java Framework 与 Native 的连接点。

建议先画一条链路，例如“应用提交一帧 buffer 到 SurfaceFlinger”，再按链路阅读，而不是按目录逐文件看。

## 每周学习节奏

- **3 天**：阅读资料和 AOSP 代码，每次 60～90 分钟。
- **2 天**：写 30～100 行小程序，验证一个概念。
- **1 天**：输出笔记：调用链、对象关系图、三个未解决问题。
- **1 天**：复盘或休息。

每篇源码笔记尽量固定记录：入口在哪里、核心对象有哪些、所有权如何流动、线程模型是什么、失败如何处理。

## 工具建议

- 用 `clangd`、`compile_commands.json` 跳转和查看类型。
- 用 `rg` 搜接口名、构造函数、`IMPLEMENT_META_INTERFACE`、`onTransact`。
- 用 `git blame` 和 `git log -S` 理解一段复杂代码为何存在。
- 用 `clang-format` 保持练习代码风格；阅读 AOSP 改动时遵循其目录的现有风格。

## 第一份实战任务

选择一个你熟悉的 Framework Java API，完成以下追踪：

1. 找到 Java API 的入口。
2. 找到对应 Binder / JNI 边界。
3. 画出 Java、C++、系统服务之间的调用关系。
4. 标注每个跨边界参数的类型转换与对象所有权。
5. 写一篇 1～2 页笔记，不追求覆盖全部细节，只追求链路正确。

完成这份任务后，再开始深入 WMS、SurfaceFlinger 或 InputFlinger，会明显更顺畅。