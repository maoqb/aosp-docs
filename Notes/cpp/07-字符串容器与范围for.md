# 字符串、容器与范围 for

STL 容器承担 Native 层大部分数据组织工作。阅读重点是复制行为、迭代器失效和复杂度，而不是记住所有成员函数。

## 常用容器

`std::string` 管理字节字符串；`std::vector` 连续存储、顺序访问快；`std::map` 按 key 有序；`std::unordered_map` 提供平均常数时间查找。选择容器前先问是否需要顺序、稳定地址、按 key 查询或排序遍历。

## 范围 for 的语义

```cpp
for (auto item : items) {}        // 副本
for (auto& item : items) {}       // 原元素的可写引用
for (const auto& item : items) {} // 只读、避免复制，最常用
```

`auto` 会丢弃顶层 const 和引用，除非显式写 `auto&` 或 `const auto&`。看到循环先确认变量究竟是副本还是别名。

## 失效规则

`vector` 扩容会移动元素，之前保存的指针、引用和迭代器可能全部失效；erase 通常使删除位置及后的迭代器失效。遍历中修改容器前必须确认规则，必要时先 reserve 或收集待删元素。

## Android 阅读视角

容器管理元素值，不一定管理元素指向对象的寿命；`vector<Foo*>` 仍需要单独回答谁销毁 Foo。跨 Binder 的字符串还可能采用 UTF-16 类型，不能把 `std::string`、`String16` 与 Java String 的编码视为完全等价。

## 易错点

- 对 map 用 `operator[]` 可能隐式插入新值；只读查询优先 `find`/`contains`。
- `unordered_map` 遍历顺序不稳定，不能依赖它生成固定输出。
