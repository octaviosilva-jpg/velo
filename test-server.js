const express = require('express');
const path = require('path');

const app = express();
const PORT = 3002;

// Servir arquivos estáticos
app.use(express.static('.'));

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Rota de teste
app.get('/test', (req, res) => {
    res.json({ 
        message: 'Servidor de teste funcionando!',
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor de teste rodando na porta ${PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
});