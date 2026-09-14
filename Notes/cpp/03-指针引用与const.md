# 指针、引用与 const

阅读一个 Native 函数，第一件事是判断它收到的是对象、副本，还是对别处对象的访问通道。指针和引用影响修改是否对调用方可见，也影响空值检查和对象生命周期。`const` 则进一步约束“通过这个访问通道能做什么”。

本篇使用 C++17，从函数签名出发建立这套阅读方法。

## 1. 对象、地址和间接访问

`int value = 7;` 创建一个 int 对象。`&value` 取得其地址；`int* pointer = &value;` 创建一个保存地址的指针对象；`*pointer` 则是访问目标对象的表达式。

```cpp
int value = 7;
int* pointer = &value;
*pointer = 9;
```

执行后 value 为 9。不是把 pointer 这个变量变成了 9，而是通过 pointer 修改它指向的 int。指针自身也有地址：`&pointer` 的类型是 int**。

指针在语法上能保存地址，但只有指向有效对象、满足类型与对齐等条件时才可解引用。非空并不证明有效：释放后的地址、越界地址都可能非零。

## 2. 引用是别名，不是自动保活机制

`int& alias = value;` 把 alias 绑定到 value。随后 `alias = 10;` 修改的是 value。引用初始化后不能“改绑”另一个对象；如果写 `alias = other;`，含义是把 other 的值赋给 value。

Java 中对象变量赋值常常复制一个引用句柄；C++ 中 `T&` 的赋值通常直接调用目标对象的赋值操作。这个差异尤其容易造成误读。

有效程序不能制造可使用的“空引用”。`T&` 参数通常表达目标必须存在，但不是运行时安全检查；通过空指针构造引用本身就已经违反规则。引用也可能悬空，编译器不能普遍替你检查寿命。

## 3. 按值、指针和引用传参究竟改变了什么

完整程序 parameter.cpp：

```cpp title="parameter.cpp"
#include <iostream>

struct Frame {
    int width;
};

void changeCopy(Frame frame) {
    frame.width = 100;
    std::cout << "inside copy: " << frame.width << '\n';
}

void changeBorrowed(Frame& frame) {
    frame.width = 200;
}

bool changeOptional(Frame* frame) {
    if (frame == nullptr) {
        return false;
    }
    frame->width = 300;
    return true;
}

int main() {
    Frame frame{640};

    changeCopy(frame);
    std::cout << "after copy: " << frame.width << '\n';

    changeBorrowed(frame);
    std::cout << "after reference: " << frame.width << '\n';

    changeOptional(&frame);
    std::cout << "after pointer: " << frame.width << '\n';
    std::cout << std::boolalpha << changeOptional(nullptr) << '\n';
}
```

```bash
g++ -std=c++17 -Wall -Wextra -Wpedantic parameter.cpp -o parameter
./parameter
```

输出：

```text
inside copy: 100
after copy: 640
after reference: 200
after pointer: 300
false
```

按值函数收到一个独立 Frame，修改不传播；引用和指针访问同一原对象，所以会传播。注意，指针参数本身也是按值传递的一个地址副本：在函数里让这个副本改指向，不会改变调用者保存的指针。

若接口确实要修改调用者的指针变量，需要 `T*&` 或 `T**`，但输出新拥有对象时，更清晰的接口通常是返回 unique_ptr，而非裸指针输出参数。

## 4. const 必须逐层读

| 类型 | 能否改变指向 | 能否经它修改目标 |
| --- | --- | --- |
| `Frame*` | 能 | 能 |
| `const Frame*` | 能 | 不能 |
| `Frame* const` | 不能 | 能 |
| `const Frame* const` | 不能 | 不能 |
| `const Frame&` | 引用不能改绑 | 不能 |

`const Frame*` 与 `Frame const*` 相同。可以从变量名向外读声明，先看星号附近的 const 限制指针自身还是目标。

const 是“这个视图不能写”，未必是“底层对象永远不会变”。一个可变 Frame 可以同时有可写引用和 const 引用；通过可写引用修改后，const 引用读到的是新值。

多级指针不能随便套用单级转换规则。例如 `T**` 不能隐式转成 `const T**`；否则接收方可能通过它塞入一个真正 const 对象的地址，原调用方又经 T* 写入，破坏 const 安全。

## 5. const 成员函数限制的是 this 视图

```cpp
class SurfaceInfo {
public:
    int width() const {
        return width_;
    }

    void resize(int width) {
        width_ = width;
    }

private:
    int width_ = 0;
};
```

width() 可以在 const SurfaceInfo 上调用，resize() 不可以。const 方法不能普通地修改非 mutable 数据成员，但可以调用其他 const 方法。

这不是递归不可变。例如类里存 `Frame* frame_;`，const 方法中指针成员自身不能改指向，却仍可能经它修改 Frame。要表达只读目标，应使用 `const Frame*` 或更合适的接口。

`mutable std::mutex` 常用于 const 查询方法内部加锁。它表达的是逻辑状态只读、同步实现可变。不要因为用了 const 就去掉读侧锁：另一个线程写同一普通字段，依然可能产生数据竞争。

## 6. 空值、借用和拥有是三个不同维度

`T*` 本身既可以代表借用，也可能是历史接口返回的拥有资源。不能看到星号就断言“不拥有”，也不能看到非空就断言“可安全使用”。

读接口需要同时回答：

| 维度 | 应寻找的证据 |
| --- | --- |
| 可空性 | 注释、空值分支、optional 或返回约定 |
| 所有权 | 谁负责 delete/close，是否返回智能指针 |
| 有效期 | 调用期间、对象存活期间，还是直到下一次容器修改 |
| 并发性 | 谁保证访问期间不会被另一个线程释放或修改 |

`get()` 通常给出智能指针管理对象的借用地址；它不转移所有权。`release()` 则放弃管理，把释放责任交给调用者。这两个函数名字相近，资源语义截然不同。

## 7. 悬空问题不能用空判断修好

下列是有意展示的错误片段，不应运行：

```cpp
const char* brokenName() {
    std::string name = "SurfaceFlinger";
    return name.c_str();
}
```

返回后 name 已析构。调用方检查返回值不是 nullptr 没有帮助。正确的接口可以返回 `std::string`，让结果对象拥有字节内容；现代返回值优化通常让这种设计很高效。

同样，vector 扩容之后，之前取得的元素指针可能失效；对象未销毁并不意味着其内部元素地址永远稳定。

异步 lambda 中捕获一个局部引用，则把这个问题延伸到了时间轴上。队列存活比局部对象更久，并不能给被引用对象续命。

## 8. 数组、长度和 view

`void process(const int* values, std::size_t count);` 需要调用方同时保证地址和长度正确。`sizeof(values)` 得到指针大小，不能求出数组长度。

C++17 中可使用 vector 的 const 引用表达只读元素范围，但它限定了容器类型；C++20 的 `std::span<const int>` 表达非拥有连续范围，可以接受多种来源。

span 和 string_view 都只是“地址加范围”等视图。它们解决接口表达问题，不解决底层生命周期问题。把临时容器转换成长期保存的 view，仍然会悬空。

## 9. 类型转换在 Android 边界上意味着什么

`static_cast` 用于有规则的显式转换，例如数值转换、已知继承关系的转换；它不自动检查窄化溢出。`dynamic_cast` 对多态向下转换提供运行时检查，但需要 RTTI 支持，不能假设所有平台模块开启 RTTI。

`reinterpret_cast` 更接近底层表示层面的转换，常见于 JNI 函数指针注册等 ABI 边界。它不会验证目标对象的类型或生命周期。

`const_cast` 仅改变 const 视图；如果实际对象本来就是 const，随后修改它仍是未定义行为。遇到它应理解接口为何需要转换，而不是把它当通用消警告手段。

## 10. 从一个 Android 风格签名读出契约

```cpp
void setListener(const android::sp<Listener>& listener);
```

这一行表示函数参数是对强指针包装对象的只读引用。它不保证 Listener 本身只读，也不说明函数是否长期持有 listener。如果实现将它赋给成员 sp，那么会建立新的强引用；如果只同步调用它，则可能只是临时借用包装对象。

因此，签名给出第一层限制，函数体中的成员赋值和异步捕获给出第二层所有权变化。把两层连起来，才能判断回调期间对象是否活着。

## 11. 规则依据

引用的限制见 [C++ 草案 dcl.ref](https://eel.is/c++draft/dcl.ref)，cv 限定见 [dcl.type.cv](https://eel.is/c++draft/dcl.type.cv)。借用对象的有效期需要与前篇的对象生命周期规则一起理解。
