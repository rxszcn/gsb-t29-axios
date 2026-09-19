// 复现：响应体上限选项传 null 时，两家适配器结论相反
import http from "node:http";
import axios from "../index.js";

const body = "x".repeat(200);
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/plain");
  res.end(body);
});

server.listen(0, async () => {
  const url = `http://127.0.0.1:${server.address().port}/big`;
  for (const v of [null, 0, undefined, 1000]) {
    for (const adapter of ["http", "fetch"]) {
      try {
        const r = await axios.get(url, { adapter, maxContentLength: v, timeout: 3000 });
        console.log(String(v).padEnd(9), adapter.padEnd(5), "-> 放行, 长度", r.data.length);
      } catch (e) {
        console.log(String(v).padEnd(9), adapter.padEnd(5), "-> 抛", e.code, JSON.stringify(String(e.message)).slice(0, 60));
      }
    }
  }
  server.close();
});
