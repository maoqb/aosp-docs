# JNI 边界

JNI 连接 Java/ART 与 C++，但两边使用不同的对象、异常、线程和生命周期规则。一个 jlong 可以保存 Native 地址，一个 jobject 可以指向 Java 对象的引用句柄，这两件事都不会自动把两套资源管理机制接起来。

本篇给出可运行的 Java/JNI 动态注册示例，并以 Android 16 的 BLASTBufferQueue 边界解释长期 Native 对象如何保活。

## 1. 两个运行时如何相遇

Java 调用 native 方法时，虚拟机按已解析的签名，把线程上下文和参数传给 C/C++ 函数。常规 JNI 静态方法前两个参数是 JNIEnv* 与 jclass；实例方法则是 JNIEnv* 与 jobject。

| Java 类型 | JNI 常见类型 | 阅读注意点 |
| --- | --- | --- |
| int / long | jint / jlong | 使用 JNI 定宽类型，不把 long 与 C++ long 混同 |
| boolean | jboolean | 不直接假设与 C++ bool 的全部表示规则相同 |
| String | jstring | 这是引用句柄，不是 char* |
| int[] | jintArray | 访问元素需要相应 JNI API |
| 普通对象 | jobject | 不是可直接解引用的 Java 对象内存 |

native 方法签名中的 native 只声明实现边界，不意味着方法自动转到后台线程。若 Java UI 线程调用阻塞 Native 函数，UI 线程仍会被阻塞。

## 2. JavaVM 与 JNIEnv 的职责

JavaVM 表示虚拟机接口，可在需要时让 Native 线程查询或附着当前线程；JNIEnv 则属于当前线程，提供对象、方法和异常访问接口。

Android 进程中的 JNIEnv 不能被保存后交给另一个线程。可共享的是合适管理的 JavaVM 指针，再由每个线程 GetEnv。未附着线程先 AttachCurrentThread，退出前由负责附着的一侧 DetachCurrentThread。

已经由 Java 创建并附着的线程，不应由随意借用它的库擅自 detach。附着责任也需要明确所有者。

## 3. 方法签名如何逐段解读

`([I)J` 表示参数是一个 int 数组，返回 long。`(Ljava/lang/String;Z)J` 表示 String 与 boolean 参数，返回 long。

基本类型用单字母描述符，引用类型写 `L包路径/类名;`，数组在元素类型前加 [。方法名相同但签名不同，可以对应重载。

注册表的 C++ 函数地址通过无类型指针传递，因此编译器不能替你验证 Java 方法的全部 ABI 签名。名字、描述符、静态/实例性质和真实函数参数必须一致。

## 4. 完整 Java 端

保存 NativeBridge.java：

```java title="NativeBridge.java"
public final class NativeBridge {
    static {
        System.loadLibrary("cpp_notes_jni");
    }

    private static native long nativeSum(int[] values);

    public static void main(String[] args) {
        System.out.println(nativeSum(new int[] {1, 2, 3, 4}));

        try {
            nativeSum(null);
        } catch (NullPointerException exception) {
            System.out.println(exception.getMessage());
        }
    }
}
```

这个示例采用默认包，方便主机运行；放进 Android 应用的包后，注册表 FindClass 的路径也要相应改变。把它放在普通 JVM 上验证可检查 JNI 边界，但不等于验证 ART 和设备业务时序。

## 5. 完整 Native 实现与动态注册

保存 native_bridge.cpp：

```cpp title="native_bridge.cpp"
#include <jni.h>

#include <algorithm>

static jlong nativeSum(JNIEnv* env, jclass, jintArray values) {
    if (values == nullptr) {
        jclass exceptionClass = env->FindClass("java/lang/NullPointerException");
        if (exceptionClass != nullptr) {
            env->ThrowNew(exceptionClass, "values must not be null");
            env->DeleteLocalRef(exceptionClass);
        }
        return 0;
    }

    jsize length = env->GetArrayLength(values);
    jlong total = 0;
    jint buffer[64];

    for (jsize offset = 0; offset < length;) {
        jsize count = std::min<jsize>(64, length - offset);
        env->GetIntArrayRegion(values, offset, count, buffer);
        if (env->ExceptionCheck()) {
            return 0;
        }
        for (jsize index = 0; index < count; ++index) {
            total += buffer[index];
        }
        offset += count;
    }

    return total;
}

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
    JNIEnv* env = nullptr;
    if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
        return JNI_ERR;
    }

    jclass bridge = env->FindClass("NativeBridge");
    if (bridge == nullptr) {
        return JNI_ERR;
    }

    JNINativeMethod methods[] = {
        {
            const_cast<char*>("nativeSum"),
            const_cast<char*>("([I)J"),
            reinterpret_cast<void*>(nativeSum)
        }
    };

    jint result = env->RegisterNatives(bridge, methods, 1);
    env->DeleteLocalRef(bridge);
    if (result != JNI_OK) {
        return JNI_ERR;
    }
    return JNI_VERSION_1_6;
}
```

代码分块复制数组到栈上缓冲区，避免为整个输入分配同等大小的 Native 数组；总和用 jlong，覆盖 int 数组长度与 int 元素乘积的相应范围。

NullPointerException 被设置后，返回值 0 不会作为成功结果交给 Java，Java 控制流进入异常分支。若 FindClass 本身失败，则保留它产生的异常，而不是继续访问空 class。

某些 JDK 头文件中 JNINativeMethod 名字字段仍是 char*，示例用 const_cast 适配声明，代码不修改字符串字面量。对函数地址的转换来自 JNI 注册接口要求，并非可以任意把数据指针当函数使用的一般规则。

## 6. 主机编译与预期结果

Linux 上安装 JDK 和 g++ 后，把 JDK_ROOT 改成实际 JDK 目录：

```bash
JDK_ROOT=/path/to/jdk
"$JDK_ROOT/bin/javac" NativeBridge.java
g++ -std=c++17 -Wall -Wextra -Wpedantic -fPIC -shared \
    -I"$JDK_ROOT/include" -I"$JDK_ROOT/include/linux" \
    native_bridge.cpp -o libcpp_notes_jni.so
"$JDK_ROOT/bin/java" -Xcheck:jni -Djava.library.path=. NativeBridge
```

输出：

```text
10
values must not be null
```

-Xcheck:jni 开启该 JVM 的 JNI 检查，帮助发现部分调用错误。Android 可用平台对应 CheckJNI 配置，但不要把主机检查通过理解为所有设备行为都已验证。

在 Android 中通常通过 CMake 或 Soong 构建同一 Native 库，由应用或系统类加载；本篇没有伪造一个可以直接 adb install 的完整 APK。

## 7. 局部、全局和弱全局引用

| 引用 | 生命周期/保活作用 | 释放方式 |
| --- | --- | --- |
| local ref | 常规 Native 调用期间在当前线程使用，并保活目标 | 调用返回或 DeleteLocalRef |
| global ref | 跨调用保存并保活 Java 目标 | DeleteGlobalRef |
| weak global ref | 不阻止 Java 目标被回收 | DeleteWeakGlobalRef |

Native 函数收到的 jobject 参数大多是局部引用。把它原样存进 C++ 成员或异步闭包，函数返回后那份句柄就可能失效，即便 Java 对象本身仍活着。

长期缓存 jclass 时要转全局引用；jmethodID/jfieldID 是另一类运行时标识，不是 jobject，不应拿去 NewGlobalRef。比较两份 Java 对象引用是否同一目标，应使用 IsSameObject，而非比较数值地址。

weak global 在使用前通常用 NewLocalRef 等方式提升为当前局部强引用；失败可能是已回收，也可能伴随分配异常，要按返回和异常状态处理。先 IsSameObject 检查再使用原弱句柄，同样有检查后被回收的窗口。

## 8. 数组和字符串不是一个“Get 后随便用”的指针

GetIntArrayElements 等接口可能复制，也可能采用其他实现策略。与之匹配的 Release 调用必须执行；它不是 local ref，因此 native 方法返回不能替代 Release。

字符串的 UTF 接口处理 Modified UTF-8，不是任意网络 UTF-8。Java String 内部语义是 UTF-16 代码单元，补充平面字符可能由代理对表示。NewStringUTF 不适合不经转换就直接接收任意字节文本。

GetStringChars 得到的 jchar 序列带独立长度约定，不要用 strlen。访问 Critical 接口期间还应遵守不阻塞、不随意调用 JNI 等限制，不能为了“零拷贝”长时间持有。

## 9. pending exception 与 C++ 异常是两套控制流

Java 异常通过 JNIEnv 的线程状态传播，ThrowNew 并不执行 C++ throw。C++ 函数仍继续执行后面的语句，除非你显式 return；这正是抛 Java 异常后又继续操作非法参数的常见来源。

发生 pending exception 后，仅执行契约允许的清理等 JNI 操作，再返回或明确处理异常。不要无条件 ExceptionClear 后继续业务，否则原本明确的失败会被掩盖。

若启用了 C++ 异常，不能让其跨 JNI 边界逃进虚拟机。需要在边界捕获、释放 Native 资源并转换为 Java 错误。RAII 可以用于清理，但析构若再次调用 JNI，也必须满足当前线程和异常状态要求。

## 10. jlong 保存 Native 地址时，谁保活对象

Android 16 的 `frameworks/base/core/jni/android_graphics_BLASTBufferQueue.cpp` 提供了一个实际例子：nativeCreate 建立 sp<BLASTBufferQueue>，额外增加一份强引用，再把裸地址编码进 jlong；nativeDestroy 按配对标识释放这份强引用。

这里要分三件事理解：

```text
局部 sp 保活 → Java 长期句柄对应的显式引用保活 → destroy 释放长期引用
```

单纯 reinterpret_cast 成 jlong 不增加任何引用计数。如果省略明确的保活协议，函数返回时局部 sp 销毁，Java 保存的数字就会变成悬空地址。

这是平台已经设计好的生命周期桥接，不建议普通业务代码随意仿写裸指针计数。还必须保证重复 destroy、并发使用、Java 侧关闭顺序都得到控制。

## 11. ClassLoader 和线程附着为何常同时出错

Native 创建的线程 Attach 后，FindClass 不一定能按调用应用类时同样的 ClassLoader 上下文查到自定义类。缓存合适的 global jclass、由 Java 传入 Class/ClassLoader，或在可控注册阶段解析，通常更可靠。

因此“已经有 JNIEnv”只解决线程资格，并未保证类解析上下文、对象寿命和异常语义全部正确。四个问题要分别检查。

## 12. 实现依据

JNI 引用、编码与线程规则参见 [Android JNI tips](https://developer.android.com/ndk/guides/jni-tips) 和 [JNI 函数规范](https://docs.oracle.com/en/java/javase/21/docs/specs/jni/functions.html)。平台桥接实例见 [Android 16 BLASTBufferQueue JNI](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r4/core/jni/android_graphics_BLASTBufferQueue.cpp)。
