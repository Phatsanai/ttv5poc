const fs = require('fs');
const path = require('path');

// 1. Scan Frontend fetch calls
const publicDir = 'z:/public';
const files = fs.readdirSync(publicDir).filter(f => f.endsWith('.html') || f.endsWith('.js'));
const frontendCalls = {};

files.forEach(file => {
  const content = fs.readFileSync(path.join(publicDir, file), 'utf8');
  const matches = [...content.matchAll(/fetch\s*\(\s*[`'"]([^`'"]+)[`'"]/g)];
  if (matches.length > 0) {
    frontendCalls[file] = matches.map(m => m[1]);
  }
});

console.log('=== FRONTEND FETCH CALLS ===');
console.log(JSON.stringify(frontendCalls, null, 2));

// 2. Scan Backend routes in server.js
const serverContent = fs.readFileSync('z:/server.js', 'utf8');
const routeMatches = [...serverContent.matchAll(/app\.(get|post|put|delete|patch)\s*\(\s*(\[[^\]]+\]|[`'"][^`'"]+[`'"])/g)];
const backendRoutes = routeMatches.map(m => `${m[1].toUpperCase()} ${m[2]}`);

console.log('\n=== BACKEND ROUTES IN server.js ===');
console.log(JSON.stringify(backendRoutes, null, 2));
