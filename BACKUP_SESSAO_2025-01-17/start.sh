#!/bin/bash

echo "========================================"
echo "    VELOTAX BOT - SISTEMA SEGURO"
echo "========================================"
echo

echo "[1/3] Verificando Node.js..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js não encontrado!"
    echo "   Baixe e instale o Node.js em: https://nodejs.org/"
    exit 1
fi
echo "✅ Node.js encontrado"

echo
echo "[2/3] Instalando dependências..."
npm install
if [ $? -ne 0 ]; then
    echo "❌ Erro ao instalar dependências!"
    exit 1
fi
echo "✅ Dependências instaladas"

echo
echo "[3/3] Iniciando servidor backend..."
echo
echo "🚀 Servidor iniciando na porta 3001..."
echo "🌐 Acesse: http://localhost:3001"
echo
echo "⚠️  IMPORTANTE: Mantenha esta janela aberta!"
echo "   O backend deve estar rodando para o sistema funcionar."
echo

node server.js
