# JNI 边界

JNI 是 Java Framework 与 C/C++ 之间的 ABI 边界。正确性重点不在调用语法，而在 `JNIEnv*`、引用类型、异常状态和线程附着。

## JNIEnv 与线程

`JNIEnv*` 只属于当前线程，不能跨线程缓存或传递。Java 线程天然已附着 JVM；Native 创建的线程必须 attach 后才能调用 JNI，退出前应 detach。把 `JNIEnv*` 存为长期成员是典型错误。

## 引用生命周期

局部引用通常在 native 调用返回时释放，但循环中大量创建会耗尽局部引用表，应及时 `DeleteLocalRef`。全局引用跨调用存活，必须显式删除；弱全局引用不阻止 Java 对象被 GC，使用前需确认对象仍存在。

## 字符串、数组与异常

获取 Java 字符串/数组可能产生复制或 pin；必须按 API 约定释放。JNI 调用如果抛出 Java 异常，线程进入 pending exception 状态，此时应尽快返回或清理，不应继续做普通 JNI 调用。Native 错误映射到 Java 异常时，要保持 API 语义一致。

## 注册与调用链

Java `native` 方法可按名称动态查找，也可在 `JNI_OnLoad` 中显式注册；后者更易重构和发现签名错误。阅读时沿着 Java 声明 → 注册表 → C++ 函数 → Native 服务依赖追踪，并标注每次类型/编码转换。

## 易错点

- 不能把局部引用保存到异步回调中。
- 不要假设 `GetStringUTFChars` 总是零拷贝。
- Native 线程回调 Java 时，除了 attach 还要处理 ClassLoader、异常和全局引用生命周期。
