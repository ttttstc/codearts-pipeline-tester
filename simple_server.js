const http = require('http');

console.log('正在尝试启动极简服务器...');

const server = http.createServer((req, res) => {
    console.log(`收到请求: ${req.method} ${req.url}`);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('你好！服务器工作正常。');
});

const port = 3000;

server.on('error', (e) => {
    console.error('SERVER ERROR:', e);
});

server.listen(port, () => {
    console.log(`服务器已启动: http://localhost:${port}`);
    console.log('请尝试在浏览器访问上述地址。');
});

// 防止进程立即退出
setInterval(() => { }, 1000);
