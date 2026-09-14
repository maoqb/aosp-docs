# AIDL NDK 与系统服务

当天目标：理解 Native 服务如何注册、被发现并被客户端调用。

- AIDL 定义接口，构建系统生成客户端/服务端的 C++ 桥接代码。
- 服务端通常通过 `AServiceManager_addService` 或对应框架接口注册服务。
- 客户端通过 ServiceManager 查询 Binder，再构造接口代理。
- 阅读一个服务时，先找注册点、接口实现、线程池启动和权限检查。

练习：选择一个小型 Native 服务，记录它的 service name、实现类和第一个业务方法。
