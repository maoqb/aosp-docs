# Lambda：把一小段行为当作对象传递

Lambda 是现场定义的可调用对象，适合给算法、线程或回调传递短逻辑。真正要审查的不是方括号有多花，而是它捕获了什么、这些对象能活多久、回调在哪个线程执行。

## 1. 基本结构

```cpp
auto add = [](int left, int right) { return left + right; };
std::cout << add(20, 22); // 42
```

编译器会为 Lambda 生成一个匿名的**闭包类型（closure type）**，捕获值成为闭包对象的成员，`()` 对应调用运算符。

## 2. 捕获方式就是保存方式

```cpp
int factor = 3;
auto byValue = [factor](int value) { return value * factor; };
auto byReference = [&factor](int value) { return value * factor; };
```

- `[factor]` 保存当时的一份副本，之后外部变量变化不影响该副本。
- `[&factor]` 保存借用关系；Lambda 延迟执行时，必须保证外部 `factor` 仍存活。
- `[=]`、`[&]` 会隐式捕获用到的局部变量，短代码方便，长生命周期回调中却容易隐藏所有权。

按值捕获默认不能修改自己的副本，需要时可写 `mutable`：

```cpp
auto next = [value = 0]() mutable { return ++value; };
```

## 3. 捕获 this 要特别小心

`[this]` 捕获的是指针，不会让对象自动存活。回调被队列长期保存，而原对象已经析构，就会通过悬空 `this` 访问内存。普通 C++ 可按设计捕获 `shared_ptr` 或 `weak_ptr`；Android `RefBase` 对象则使用相应 `sp`/`wp` 协议。

## 4. 完整示例：筛选并转换数据

```cpp title="lambda_demo.cpp"
#include <algorithm>
#include <iostream>
#include <vector>

int main() {
    std::vector<int> values{1, 2, 3, 4, 5, 6};
    int threshold = 3;

    values.erase(std::remove_if(values.begin(), values.end(),
                                [threshold](int value) {
                                    return value < threshold;
                                }),
                 values.end());

    std::for_each(values.begin(), values.end(), [](int& value) {
        value *= 10;
    });

    for (int value : values) std::cout << value << ' ';
    std::cout << '\n';
}
```

```bash
g++ -std=c++17 -Wall -Wextra -Wpedantic lambda_demo.cpp -o lambda_demo
./lambda_demo
```

输出 `30 40 50 60`。第一个 Lambda 按值保存阈值，第二个接收元素引用并原地修改。

## 5. 泛型 Lambda 与回调包装

```cpp
auto larger = [](const auto& a, const auto& b) { return a < b ? b : a; };
```

参数写 `auto` 后，调用运算符相当于模板。若调用方可以保留具体 Lambda 类型，直接用模板通常最轻；必须把多种可调用对象装进统一类型时，可用 `std::function`，但它可能发生分配，且 C++17 所保存目标通常需要可复制。

规则细节可查 C++17 工作草案 N4659 的 §8.1.5 `[expr.prim.lambda]`。
