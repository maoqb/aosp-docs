# 模板、Lambda 与回调

Android C++ 代码经常把类型、构造参数甚至一段待执行操作传给另一个组件。模板负责在编译期组合类型，Lambda 将状态和行为封装成对象，回调机制再决定这些对象什么时候、在哪个线程执行。

它们经常出现在同一行代码中，但需要分别分析。本篇先解释类型推导，再解释闭包所有权，示例使用 C++17。

## 1. 模板和 Java 泛型的关键差异

Java 泛型主要依赖类型擦除及其相关约束；C++ 模板则通常针对具体实参生成不同实例。`vector<int>` 和 `vector<string>` 具有各自布局与操作，int 不需要为了成为模板实参而装箱。

模板参数可以是类型，也可以是编译期值。例如 `std::array<int, 4>` 中 int 是类型参数，4 是非类型参数，直接参与类型身份。

模板定义可先通过语法分析，而与 T 有关的错误在实例化时才暴露。因此“模板定义文件编译没报错”，不代表用任何类型实例化都有效。

## 2. 一个函数模板隐含了哪些要求

```cpp
template <typename Container>
bool hasElements(const Container& values) {
    return !values.empty();
}
```

这个模板并不接受任意东西。它要求实参能以 const 视图调用 empty，并且结果可以取反。传 vector 合适，传没有 empty 的普通结构体则实例化失败。

阅读时应将模板看成“对类型的操作契约”，先在调用点确定 Container，再把函数体中的操作逐一映射到具体类型。C++20 concepts 可以显式表达许多要求，但老的 Android 代码会用 enable_if、traits 等方式间接表达。

## 3. 类型推导为什么会丢掉引用

```cpp
template <typename Value>
void consumeCopy(Value value);

template <typename Value>
void inspectBorrowed(const Value& value);
```

前者按值接收，推导通常去掉实参顶层 const 和引用；后者保留只读借用关系，避免复制。数组在按值推导中可能退化为指针，引用参数则可以保留数组相关类型信息。

auto 的许多规则与按值模板推导类似。想知道到底推导成什么，可借助 static_assert 和 type_traits，而不必靠日志猜类型名称。

## 4. T&& 有时是转发引用，有时不是

当 T 是在当前函数模板调用中推导出的、无 cv 限定的类型参数时，`T&&` 可以是转发引用。传入左值时，T 可推导成引用类型，再按引用折叠规则得到左值引用。

| 组合 | 折叠结果 |
| --- | --- |
| T& 与 & | T& |
| T& 与 && | T& |
| T&& 与 & | T& |
| T&& 与 && | T&& |

简记为：出现左值引用通常折叠为左值引用。

若函数直接声明 `void set(std::string&&);`，这是普通右值引用，不是转发引用。类模板中已经固定的 T 再用于非独立推导位置，也不能机械地当转发引用。

函数体内参数名字始终是左值表达式。std::forward<T>(value) 用原推导结果恢复调用者传入的值类别；std::move 则无条件给出可移动视图。二者用途不同。

## 5. 可运行的转发示例

```cpp title="forwarding.cpp"
#include <iostream>
#include <string>
#include <utility>

void select(const std::string&) {
    std::cout << "borrowed\n";
}

void select(std::string&&) {
    std::cout << "movable\n";
}

template <typename Value>
void forwardToSelect(Value&& value) {
    select(std::forward<Value>(value));
}

int main() {
    std::string name = "surface";
    forwardToSelect(name);
    forwardToSelect(std::string("temporary"));
}
```

输出是 borrowed、movable 两行。包装函数没有改变调用者的值类别。如果把 forward 替换成 value，两个调用都因命名参数是左值而选 borrowed；替换成 move，则可能把原本只打算借用的左值交给消费型重载。

完美转发只是保留类型和类别，不保证目标操作正确。将同一参数多次 forward 给消费资源的函数，可能二次使用已移动的对象。

## 6. typename、using 与 if constexpr

模板中 `typename Container::value_type` 的 typename 说明依赖于模板参数的名字是类型；没有它，解析器未必能按类型理解。`using Element = ...;` 则给复杂类型起一个局部别名，不创建新的运行时对象。

C++17 的 if constexpr 根据编译期条件选择分支。在模板实例化中，被舍弃分支的相关依赖操作不必对该实参有效；普通 if 的两个分支通常仍需能编译。

这些机制的阅读价值在于缩小有效代码范围：确定实参后，许多看起来复杂的分支实际上已经不参与本实例。

## 7. Lambda 是一个带成员的闭包对象

`[name] { use(name); }` 可以近似理解成编译器生成一个类，把 name 复制进成员，再提供 operator()。捕获不是注释，而是真正的存储和生命周期安排。

| 捕获 | 闭包保存什么 | 主要风险 |
| --- | --- | --- |
| [value] | 一份值副本 | 副本可能仍是借用类型，例如 string_view |
| [&value] | 对外部对象的借用 | 外部对象先销毁 |
| [this] | 当前对象指针 | 不保活当前对象 |
| [owner = std::move(owner)] | 转移进闭包的所有者 | 闭包可能变为 move-only |
| [weak] | 弱观察句柄 | 调用前必须提升 |

默认 operator() 通常是 const，mutable 允许修改按值捕获的闭包内部成员，不会自动修改外面的原变量。复制闭包也会复制它的捕获状态；如果捕获 unique_ptr，闭包一般不能复制。

## 8. 完整示例：回调存储与对象寿命

下面的队列有意在同一线程延后执行，用来把“延迟”和“并发”拆开。即使没有线程，引用捕获也可能因执行时间晚而悬空。

```cpp title="callback_lifetime.cpp"
#include <functional>
#include <iostream>
#include <memory>
#include <string>
#include <utility>
#include <vector>

class TaskQueue {
public:
    void post(std::function<void()> task) {
        tasks_.push_back(std::move(task));
    }

    void drain() {
        auto pending = std::move(tasks_);
        tasks_.clear();
        for (auto& task : pending) {
            task();
        }
    }

private:
    std::vector<std::function<void()>> tasks_;
};

class Receiver {
public:
    void receive(int value) {
        std::cout << "received " << value << '\n';
    }
};

int main() {
    TaskQueue queue;

    {
        std::string label = "frame ready";
        queue.post([label] {
            std::cout << label << '\n';
        });
    }

    auto receiver = std::make_shared<Receiver>();
    std::weak_ptr<Receiver> observer = receiver;
    queue.post([observer] {
        if (auto locked = observer.lock()) {
            locked->receive(7);
        } else {
            std::cout << "receiver expired\n";
        }
    });

    receiver.reset();
    queue.drain();

    auto ownedTask = [value = std::make_unique<int>(42)] {
        return *value;
    };
    std::cout << ownedTask() << '\n';
}
```

```bash
g++ -std=c++17 -Wall -Wextra -Wpedantic callback_lifetime.cpp -o callback_lifetime
./callback_lifetime
```

输出：

```text
frame ready
receiver expired
42
```

第一项复制 string，因此原变量作用域结束后仍能打印。第二项只弱观察 Receiver，reset 后执行时正常走过期分支。最后一个闭包拥有 unique_ptr，可直接调用，但不能按 C++17 std::function 的复制目标要求直接放进该队列。

## 9. std::function 的便利与代价

函数指针可表示无捕获函数调用目标；模板参数可保留具体可调用对象类型并利于优化；std::function 用类型擦除把不同签名兼容的目标装进同一种包装。

C++17 std::function 要求所保存目标满足相应复制要求；它可能使用小对象优化，也可能分配内存，不能承诺所有 lambda 都零分配。为空时调用会抛 bad_function_call，因此要通过接口保证已设置，或在调用前检查。

需要 move-only 任务时，可选择基于模板的直接传递、packaged_task 等适用结构，或在支持 C++23 的工程中考虑 move_only_function。不要为了塞进 std::function 就随意把独占资源改成 shared_ptr。

## 10. Android 回调还要补上线程契约

看到 post、schedule、onFrameAvailable，必须确认：函数是在当前线程同步调用，还是投递到另一个 Looper；注销 listener 是否等待已在执行的回调；闭包销毁可能发生在哪个线程。

强捕获解决保活，不能解决状态竞争；弱捕获避免永久保活，不能保证业务还处于运行状态。获得对象后，还可能需要检查 generation、关闭状态或请求是否仍有效。

前篇提到的析构重入也在这里出现：销毁队列中的最后一份强捕获，可能销毁服务。队列清理时是否持锁，必须一起审查。

## 11. 阅读依据

Lambda 语义见 [expr.prim.lambda](https://eel.is/c++draft/expr.prim.lambda)，模板实参推导见 [temp.deduct.call](https://eel.is/c++draft/temp.deduct.call)。在 Android 代码中，将推导得到的实际类型和闭包捕获对象分别写出来，通常比从模板嵌套最内层开始读更清楚。
