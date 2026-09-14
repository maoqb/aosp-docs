# Binder 与 Parcel

Binder 是 Android 跨进程对象调用机制。Native 层阅读 Binder 时，先掌握对象角色和一次事务的序列化路径，再进入驱动和线程池细节。

## 角色与路径

客户端通常持有 Proxy（常见 `Bp*`），服务端提供 Stub（常见 `Bn*`）和真实实现。调用链可概括为：

```text
客户端接口调用 → Proxy 写 Parcel → transact → Binder 驱动
→ 服务端线程取事务 → Stub onTransact → 实现类 → reply Parcel
```

`IBinder` 是 Binder 对象抽象；本地对象与远端对象在调用侧可能都表现为 `sp<IBinder>`，但调用成本和线程边界不同。

## Parcel

Parcel 按顺序写入和读取字段，类型、顺序与边界必须一致。AIDL 生成代码替你维护大部分协议；手写 transact 时尤其要警惕读写不匹配、权限 token、文件描述符和 Binder 对象传递。

同步事务等待 reply；oneway 事务异步排队且没有 reply，不能依赖它立即完成。不要在 Binder 线程中做长时间工作，应转交到专用线程或队列。

## 服务端分发

`onTransact` 根据 transaction code 选择方法，检查接口描述符并反序列化参数。服务端实现仍需自己做权限、参数范围、调用者身份和线程安全检查；“调用来自系统”不等于可信。

## Android 阅读入口

从一个小 AIDL 接口生成的 C++ 代码开始，分别找到客户端调用、服务实现和服务注册。再读 `frameworks/native/libs/binder/Parcel.cpp`、`Binder.cpp`。每次追踪都标注：参数如何编码、在哪个线程执行、返回错误如何传回。

## 易错点

- Binder 句柄不是普通 C++ 指针，远端对象可死亡，需处理 death recipient 或失败返回。
- 持锁发同步 Binder 调用易形成跨服务死锁。
- oneway 只是不等待 reply，不保证无限吞吐或执行顺序之外的业务语义。
