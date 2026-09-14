# 字符串、容器与范围 for

当天目标：能无障碍阅读最常见的 STL 数据处理代码。

- 熟悉 `std::string`、`std::vector`、`std::map`、`std::unordered_map` 的基本语义。
- 区分复制遍历 `for (auto item : values)` 与借用遍历 `for (const auto& item : values)`。
- 迭代器失效通常发生在容器扩容、删除或重新排序后。
- `auto` 由初始化表达式推导；复杂类型可读性更好，但关键接口仍要知道实际类型。

练习：解析一段 key-value 文本到 `unordered_map`，并用 `const auto&` 输出。
