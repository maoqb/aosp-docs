# RAII 与资源管理

RAII 将资源获取和释放绑定到对象生命周期：构造时获取，析构时释放。函数正常返回、提前 return 或异常展开时析构都会发生，因此它是 C++ 管理资源的核心方式。

## 资源的范围

资源不只是堆内存。文件描述符、互斥锁、Binder 引用、mmap 映射、EGL 对象和线程都需要成对获取/释放。把释放写在每条控制流末尾容易遗漏；封装为 RAII 对象则由作用域保证。

```cpp
void Update() {
  std::lock_guard<std::mutex> lock(mutex_);
  if (!ready_) return; // lock 析构并自动解锁
  CommitLocked();
}
```

## RAII 类型设计

独占资源类型应在析构中无条件释放，不能随意复制；通常删除拷贝并支持移动。析构函数不能抛异常。`std::unique_ptr<T, Deleter>` 可以管理 C 风格资源，Android 中也常见 `unique_fd` 一类 fd 封装。

## 锁与作用域

使用 `lock_guard` 表达固定作用域加锁，使用 `unique_lock` 表达延迟加锁、条件变量等待或提前解锁。锁粒度应小；不要持锁做 Binder 调用、IO 或未知回调，否则可能死锁或造成系统卡顿。

## Android 阅读视角

先看析构函数和 scope guard，通常比从业务代码猜释放位置更可靠。命名带 `Locked` 的方法一般要求调用者已持有特定 mutex；这是锁前置条件，调用前必须核实。

## 易错点

- RAII 管理一切有获取/释放对的资源，不只是内存。
- 不要依赖类似 Java finalizer 的兜底逻辑；C++ 要依赖确定析构。
- 构造失败时，已构造完成的成员会自动析构，成员本身也应采用 RAII。
