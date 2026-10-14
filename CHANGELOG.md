# Changelog

Todas as mudanças relevantes deste projeto ficam registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adota o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não publicado]

### Adicionado

- Modo **Resumo**: terceiro botão que só resume o trecho (parágrafo de até 150 palavras, Decisões e combinados, Em aberto), mesma coleta e mesmo custo estimado dos outros modos.

### Alterado

- Brief pra IA: "Entregável esperado" foi fundido em "O que foi pedido" (6 seções); perguntas só do que bloqueia e sem repetir Lacunas; só a decisão vigente, sem o histórico que ela substituiu; nunca IDs numéricos de contato; alvo de até 600 palavras pra trechos de até 200 mensagens.
- Coleta: menções `@<número>` em grupos (jids `@lid`) viram `@Nome` via o Store; sem nome, viram um apelido estável `@participante-N` dentro do trecho.

## [1.0.0] - 2026-10-14

Primeira versão pública.

### Adicionado

- **Card dentro do WhatsApp Web**: um botão no trilho lateral abre o card sobre a conversa, sem trocar de aba. A sidebar (Firefox/Zen) e o painel lateral (Chrome) continuam disponíveis.
- **Trecho resolvido pela Store do WhatsApp**: você marca a primeira e a última mensagem e o intervalo sai dos dados internos do chat, com autor, horário, respostas citadas e mídias (áudio, imagem, PDF) baixadas sob demanda.
- **Transcrição de áudio (STT) via OpenRouter**: ElevenLabs Scribe como modelo primário e um modelo de fallback, com nova tentativa em erro transitório e limites de minutos por áudio e por trecho.
- **Dois modos de saída**, gerados pelo Claude Opus 5.5 via OpenRouter:
  - **Tasks**: checklist estruturado (pedido a mim, pedido ao grupo, compromisso meu, dependência) com prazo em data absoluta, quem pediu, confiança, mensagens de origem `#n` e pendências.
  - **Brief**: Markdown com seções fixas, pronto pra entregar a um agente de IA.
- **Fallback só-texto pelo DOM**: quando a Store não responde, o trecho é lido do que está renderizado na tela, sem mídia, e o resultado avisa o que ficou de fora.
- **Diagnóstico**: botão que confere os módulos internos do WhatsApp usados pela extensão e aponta qual deles mudou.
- **Custo sob controle**: estimativa antes de enviar, confirmação quando o custo estimado passa de um valor configurável e preços por milhão de tokens e por minuto de áudio editáveis.
- **Privacidade por padrão**: o conteúdo do trecho é tratado como dado, não como instrução (proteção contra prompt injection); nada é enviado sem clique; a chave da OpenRouter fica só no armazenamento local do navegador.
- **Firefox/Zen e Chrome**: `manifest.json` (Firefox/Zen, com sidebar) e `manifest.chrome.json` (Chrome, com side panel), ambos Manifest V3.
- CI no GitHub Actions (testes, typecheck, `web-ext lint` e build do `.xpi`) e release automático a cada tag `v*`.

[Não publicado]: https://github.com/ArthurMalucelli/whattasks/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ArthurMalucelli/whattasks/releases/tag/v1.0.0
