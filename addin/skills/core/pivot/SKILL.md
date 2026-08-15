# pivot

按当前表头做透视表。字段名必须来自 inspect，不要猜「类别」「金额」。

`create_pivot`：指定行字段、可选列字段、值字段（sum/count/average/min/max）。结果写到新表，源表不改。
