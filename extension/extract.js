function ceExtractGrids() {
  const txt = (el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  const grids = [];
  const push = (rows) => {
    const clean = (rows || [])
      .map((r) => (r || []).map((c) => String(c || "").trim()))
      .filter((r) => r.some(Boolean));
    if (clean.length) grids.push(clean);
  };
  document.querySelectorAll("table").forEach((t) => {
    push(
      [...t.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("th,td")].map(txt))
    );
  });
  document.querySelectorAll(".ant-table, .el-table, .vxe-table, .kd-table").forEach((root) => {
    const head = [
      ...root.querySelectorAll("thead th, .ant-table-thead th, .el-table__header th, .vxe-header--column"),
    ].map(txt);
    const body = [...root.querySelectorAll("tbody tr, .ant-table-row, .el-table__row, .vxe-body--row")].map((tr) =>
      [...tr.querySelectorAll("td, .vxe-body--column")].map(txt)
    );
    push(head.length ? [head, ...body] : body);
  });
  const ariaRoot = document.querySelector('[role="grid"], [role="table"]');
  if (ariaRoot) {
    push(
      [...ariaRoot.querySelectorAll('[role="row"]')].map((tr) =>
        [...tr.querySelectorAll('[role="columnheader"], [role="gridcell"], [role="cell"]')].map(txt)
      )
    );
  }
  return grids;
}
