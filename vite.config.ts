import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'fs';
import path from 'path';

function offlineSingleFilePlugin(): Plugin {
  return {
    name: 'offline-single-file-plugin',
    enforce: 'post',
    // 开发模式下使用 index.dev.html 提供 HMR
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/' || req.url === '/index.html') {
          try {
            const devHtmlPath = path.resolve(__dirname, 'index.dev.html');
            if (fs.existsSync(devHtmlPath)) {
              const content = fs.readFileSync(devHtmlPath, 'utf-8');
              const html = await server.transformIndexHtml(req.url, content);
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
              res.end(html);
              return;
            }
          } catch (e) {
            return next(e);
          }
        }
        next();
      });
    },
    // 构建完成后，去除 type="module"，并将 script 移至 body 底部，使在本地 file:// 协议下双击直接运行
    closeBundle() {
      const sourceDist = path.resolve(__dirname, 'dist', 'index.source.html');
      const standardDist = path.resolve(__dirname, 'dist', 'index.html');
      const targetDist = fs.existsSync(sourceDist) ? sourceDist : (fs.existsSync(standardDist) ? standardDist : null);

      if (targetDist) {
        let html = fs.readFileSync(targetDist, 'utf-8');
        // 移除 module 限制，防止本地 file:// 协议下的 CORS 报错
        html = html.replace(/<script type="module" crossorigin>/g, '<script>');
        html = html.replace(/<script type="module">/g, '<script>');

        fs.writeFileSync(standardDist, html, 'utf-8');
        if (fs.existsSync(sourceDist) && sourceDist !== standardDist) {
          fs.unlinkSync(sourceDist);
        }

        // 同步生成根目录的 index.html 和 双击直接打开.html，让用户直接双击秒开
        const rootHtmlPath = path.resolve(__dirname, 'index.html');
        const openHtmlPath = path.resolve(__dirname, '双击直接打开.html');
        fs.writeFileSync(rootHtmlPath, html, 'utf-8');
        fs.writeFileSync(openHtmlPath, html, 'utf-8');
        console.log('[offline-plugin] 已成功生成本地双击可直接运行的网页:');
        console.log(' - index.html');
        console.log(' - 双击直接打开.html');
        console.log(' - dist/index.html');
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), viteSingleFile(), offlineSingleFilePlugin()],
  base: './',
  server: {
    host: true,
    port: 5185,
    watch: { ignored: ['**/public/**'] },
  },
  preview: {
    host: true,
    port: 4185,
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: path.resolve(__dirname, 'index.source.html'),
    },
    chunkSizeWarningLimit: 2000,
  },
});
