# Binder 与 Parcel

当天目标：能画出一次 Native Binder 调用从客户端到服务端的路径。

- `IBinder` 表示 Binder 对象；客户端通常持有 Proxy，服务端提供 Stub。
- `Parcel` 负责跨进程参数序列化，顺序和类型必须与读端一致。
- `onTransact` 是服务端事务分发入口，Proxy 负责打包和发起 transact。
- 阅读时先画：调用者 → Proxy → Parcel → Binder 驱动 → Stub → 服务实现。

练习：从一个简单 AIDL 接口生成的 C++ 代码中找出 Proxy、Stub 和 transact code。
