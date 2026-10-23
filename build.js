// Assemble la page en un seul fichier HTML autonome.
// node build.js  ->  dist/parite15.html (fragment publié) et dist/index.html (document complet)
const fs = require('fs');
const path = require('path');

const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');

const head = `<title>Parité 15×15</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@600;700&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&display=swap">
<style>
${src('style.css')}
</style>`;

const body = `${src('page.html')}
<script>
${src('core.js')}
</script>
<script>
${src('app.js')}
</script>`;

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'parite15.html'), `${head}\n${body}\n`);
fs.writeFileSync(
  path.join(__dirname, 'dist', 'index.html'),
  `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
<style>[hidden]{display:none!important} body{margin:0} :root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}</style>
</head>
<body>
${body}
</body>
</html>
`,
);
console.log('dist/parite15.html et dist/index.html générés');
