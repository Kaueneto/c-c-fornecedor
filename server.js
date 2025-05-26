const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const { exec } = require('child_process');
app.use(express.json());

// Detecta o diretório base (funciona no .exe também)
const baseDir = process.pkg ? path.dirname(process.execPath) : __dirname;

// Caminho dos arquivos externos (fora do .exe)
const publicDir = path.join(baseDir, 'public');
const contasPath = path.join(publicDir, 'contas.jsonl');
const extratoPath = path.join(publicDir, 'extrato.jsonl');

// Serve os arquivos estáticos da pasta public
app.use(express.static(publicDir));

// Página inicial
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'contas.html'));
});

// API: Lista contas
app.get('/api/contas', (req, res) => {
  if (!fs.existsSync(contasPath)) return res.json([]);
  const linhas = fs.readFileSync(contasPath, 'utf-8').split('\n').filter(Boolean);
  res.json(linhas.map(JSON.parse));
});

// API: Adiciona conta
app.post('/api/contas', (req, res) => {
  fs.appendFileSync(contasPath, JSON.stringify(req.body) + '\n');
  res.status(201).json({ message: 'Conta cadastrada com sucesso!' });
});

// API: Salva movimento no extrato
app.post('/api/extrato', (req, res) => {
  fs.appendFileSync(extratoPath, JSON.stringify(req.body) + '\n');
  res.json({ ok: true });
});

// API: Atualiza saldo da conta
app.put('/api/contas/saldo', (req, res) => {
  const { codigo, novoSaldo } = req.body;
  if (!fs.existsSync(contasPath)) return res.status(404).json({ error: 'Conta não encontrada' });

  const linhas = fs.readFileSync(contasPath, 'utf-8').split('\n').filter(Boolean);
  let alterado = false;
  const novas = linhas.map(l => {
    const conta = JSON.parse(l);
    if (conta.codigo === codigo) {
      conta.saldo = novoSaldo;
      alterado = true;
    }
    return JSON.stringify(conta);
  });
  if (alterado) {
    fs.writeFileSync(contasPath, novas.join('\n') + '\n');
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Conta não encontrada' });
  }
});

// API: Edita descrição da conta
app.put('/api/contas/:codigo', (req, res) => {
  const codigo = req.params.codigo;
  const { descricao } = req.body;
  if (!fs.existsSync(contasPath)) return res.status(404).json({ error: 'Conta não encontrada' });

  const linhas = fs.readFileSync(contasPath, 'utf-8').split('\n').filter(Boolean);
  let alterado = false;
  const novas = linhas.map(l => {
    const conta = JSON.parse(l);
    if (conta.codigo === codigo) {
      conta.descricao = descricao;
      alterado = true;
    }
    return JSON.stringify(conta);
  });
  fs.writeFileSync(contasPath, novas.join('\n') + '\n');
  if (alterado) {
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Conta não encontrada' });
  }
});

// API: Lista extrato
app.get('/api/extrato', (req, res) => {
  const { codigo, inicio, fim } = req.query;
  if (!fs.existsSync(extratoPath)) return res.json([]);
  let movs = fs.readFileSync(extratoPath, 'utf-8').split('\n').filter(Boolean)
    .map(l => JSON.parse(l)).filter(m => m.codigoConta === codigo);
  if (inicio) movs = movs.filter(m => m.data >= inicio);
  if (fim) movs = movs.filter(m => m.data <= fim);
  res.json(movs);
});

// API: Deleta conta
app.delete('/api/contas/:codigo', (req, res) => {
  const codigo = req.params.codigo;
  if (!fs.existsSync(contasPath)) return res.status(404).json({ error: 'Conta não encontrada' });

  const linhas = fs.readFileSync(contasPath, 'utf-8').split('\n').filter(Boolean);
  const contas = linhas.map(l => JSON.parse(l));
  const contaExiste = contas.some(c => c.codigo === codigo);
  if (!contaExiste) return res.status(404).json({ error: 'Conta não encontrada' });

  // Verifica se tem movimentação
  let temMovimentacao = false;
  if (fs.existsSync(extratoPath)) {
    const movimentos = fs.readFileSync(extratoPath, 'utf-8').split('\n').filter(Boolean)
      .map(l => JSON.parse(l)).filter(m => m.codigoConta === codigo);
    temMovimentacao = movimentos.length > 0;
  }

  // Remove e salva
  const novas = contas.filter(c => c.codigo !== codigo);
  fs.writeFileSync(contasPath, novas.map(c => JSON.stringify(c)).join('\n') + (novas.length ? '\n' : ''));

  res.json({ ok: true, temMovimentacao });
});

// API: Deleta movimento do extrato
app.delete('/api/extrato/:id', (req, res) => {
  const id = req.params.id;
  if (!fs.existsSync(extratoPath)) return res.status(404).json({ error: 'Extrato não encontrado' });

  const linhas = fs.readFileSync(extratoPath, 'utf-8').split('\n').filter(Boolean);
  const movimentos = linhas.map(l => JSON.parse(l));
  const movExcluido = movimentos.find(m => String(m.id) === String(id));
  if (!movExcluido) return res.status(404).json({ error: 'Movimento não encontrado' });

  // Remove o movimento
  const novos = movimentos.filter(m => String(m.id) !== String(id));
  fs.writeFileSync(extratoPath, novos.map(m => JSON.stringify(m)).join('\n') + (novos.length ? '\n' : ''));

  // Recalcula o saldo da conta
  if (fs.existsSync(contasPath)) {
    const contaCodigo = movExcluido.codigoConta;
    // Pega todos os movimentos restantes da conta
    const movsConta = novos.filter(m => m.codigoConta === contaCodigo);
    // O saldo será o saldo do último movimento, ou 0 se não houver mais movimentos
    const novoSaldo = movsConta.length > 0 ? movsConta[movsConta.length - 1].saldo : 0;

    // Atualiza o saldo no contas.jsonl
    const contasLinhas = fs.readFileSync(contasPath, 'utf-8').split('\n').filter(Boolean);
    const contasNovas = contasLinhas.map(l => {
      const conta = JSON.parse(l);
      if (conta.codigo === contaCodigo) {
        conta.saldo = novoSaldo;
      }
      return JSON.stringify(conta);
    });
    fs.writeFileSync(contasPath, contasNovas.join('\n') + '\n');
  }

  res.json({ ok: true });
});

// Inicia servidor
app.listen(3000, () => {
  console.log('Servidor rodando em http://localhost:3000');
  exec('start http://localhost:3000'); // Abre o navegador automaticamente
});