# Rule of Five：资源类为什么要考虑五个特殊成员函数

如果类直接管理需要释放的资源，只写析构函数通常不够。拷贝和移动也必须说明资源责任如何变化，否则就可能重复释放或泄漏。更好的默认选择是 Rule of Zero：让 `vector`、`string`、`unique_ptr` 等成员替你管理资源。

## 1. 五个函数分别在何时使用

```cpp
class Buffer {
public:
    ~Buffer();                         // 析构
    Buffer(const Buffer&);             // 拷贝构造
    Buffer& operator=(const Buffer&);  // 拷贝赋值
    Buffer(Buffer&&) noexcept;          // 移动构造
    Buffer& operator=(Buffer&&) noexcept; // 移动赋值
};
```

- 构造创建新对象；赋值修改已经存在的对象。
- 拷贝后两个对象都必须能独立使用。
- 移动把资源责任交给目标，源对象仍需保持可析构、可重新赋值。
- 析构只释放当前对象仍拥有的资源。

**Rule of Five** 不是“必须手写五个”，而是提醒：一旦资源语义迫使你自定义其中一个，就要审查另外四个是否仍正确。

## 2. 完整示例：深拷贝并支持移动的缓冲区

```cpp title="rule_of_five_demo.cpp"
#include <algorithm>
#include <cstddef>
#include <iostream>
#include <utility>

class Buffer {
public:
    explicit Buffer(std::size_t size)
        : size_(size), data_(size == 0 ? nullptr : new int[size]{}) {}

    ~Buffer() { delete[] data_; }

    Buffer(const Buffer& other) : Buffer(other.size_) {
        if (size_ != 0) {
            std::copy(other.data_, other.data_ + other.size_, data_);
        }
    }

    Buffer& operator=(const Buffer& other) {
        if (this == &other) return *this;
        Buffer copy(other);
        swap(copy);
        return *this;
    }

    Buffer(Buffer&& other) noexcept
        : size_(std::exchange(other.size_, 0)),
          data_(std::exchange(other.data_, nullptr)) {}

    Buffer& operator=(Buffer&& other) noexcept {
        if (this == &other) return *this;
        delete[] data_;
        size_ = std::exchange(other.size_, 0);
        data_ = std::exchange(other.data_, nullptr);
        return *this;
    }

    void swap(Buffer& other) noexcept {
        std::swap(size_, other.size_);
        std::swap(data_, other.data_);
    }

    int& operator[](std::size_t index) { return data_[index]; }
    const int& operator[](std::size_t index) const { return data_[index]; }
    std::size_t size() const { return size_; }

private:
    std::size_t size_ = 0;
    int* data_ = nullptr;
};

int main() {
    Buffer first(2);
    first[0] = 7;

    Buffer copied = first;
    copied[0] = 9;

    Buffer moved = std::move(first);
    std::cout << copied[0] << ' ' << moved[0]
              << " old-size=" << first.size() << '\n';
}
```

```bash
g++ -std=c++17 -Wall -Wextra -Wpedantic rule_of_five_demo.cpp -o rule_of_five_demo
./rule_of_five_demo
```

输出 `9 7 old-size=0`。深拷贝让 `copied` 与原缓冲区互不影响；移动用 `std::exchange` 取走指针并把源对象清空。

## 3. 为什么拷贝赋值使用临时副本

先构造 `copy`，成功后再交换，能同时处理自赋值和分配失败：如果复制内存时抛异常，原对象还没被修改。这种“先得到完整新状态，再一次提交”的思路比先删除旧内存更可靠。

## 4. 生产代码优先 Rule of Zero

上面的手写类用于理解规则。实际代码更应写成：

```cpp
class Buffer {
    std::vector<int> data_;
};
```

此时编译器生成的五个函数会组合 `vector` 已正确实现的语义，通常一个都不用手写。需要禁止拷贝的独占资源则用 `unique_ptr` 或 `unique_fd`，让类型系统表达限制。

规则细节可查 C++17 工作草案 N4659 的 `[class.copy.ctor]`、`[class.copy.assign]`、`[class.dtor]`。
