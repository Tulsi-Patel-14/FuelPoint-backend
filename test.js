fetch('http://localhost:5000/api/v1/admin/workers', { method: 'OPTIONS' }).then(r => console.log('OPTIONS status:', r.status)).catch(e => console.log('error', e));
