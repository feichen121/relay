// 出口中转 —— Vercel 原生 Serverless Function（Node 运行时）
// 放置路径：仓库根目录下的 api/relay.js
// 访问方式：https://<你的项目>.vercel.app/api/relay?u=<encodeURIComponent(目标URL)>
//
// 用 CommonJS 写法，不依赖 package.json 的 type 字段，兼容性最好。
// 这个文件不需要任何构建步骤，Vercel 会直接把 api/ 下的文件当函数用。

module.exports = async function handler(req, res) {
  const target = req.query && req.query.u;
  if (!target) {
    res.status(400).json({ error: "missing u" });
    return;
  }

  // ---- 取出请求体 ----
  // Vercel 的 Node 函数默认会解析 JSON body，所以两种形态都要兼容
  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (req.body !== undefined && req.body !== null) {
      if (Buffer.isBuffer(req.body)) {
        body = req.body;
      } else if (typeof req.body === "string") {
        body = req.body;
      } else {
        body = JSON.stringify(req.body);
      }
    } else {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = Buffer.concat(chunks);
    }
  }

  const init = {
    method: req.method,
    headers: {
      "Content-Type": req.headers["content-type"] || "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    redirect: "follow",
  };
  if (body !== undefined && body.length) init.body = body;

  // ---- 转发 ----
  let r;
  try {
    r = await fetch(target, init);
  } catch (e) {
    res.status(502).json({ error: "relay_fetch_failed", detail: String(e) });
    return;
  }

  const buf = Buffer.from(await r.arrayBuffer());

  res.status(r.status);
  res.setHeader("Content-Type", r.headers.get("content-type") || "application/json");
  res.setHeader("Cache-Control", "no-store");

  // 关键：把上游的 Set-Cookie 透传回去
  // 否则 gptimage 认不出游客身份，任务建了也轮询不到结果
  let sc = null;
  if (typeof r.headers.getSetCookie === "function") {
    const arr = r.headers.getSetCookie();
    if (arr && arr.length) sc = arr;
  }
  if (!sc) {
    const one = r.headers.get("set-cookie");
    if (one) sc = one;
  }
  if (sc) res.setHeader("set-cookie", sc);

  res.send(buf);
};

// 中转要给上游留足时间
module.exports.config = { maxDuration: 60 };

