# Câmbio — conversor de moedas (PWA)

App web simples para converter valores entre as suas moedas favoritas.

- Favorite as moedas que quiser (estrela no canto superior) e reordene com as setas.
- Digite um valor em qualquer moeda da lista: as outras são convertidas na hora.
- Funciona offline com as últimas cotações salvas.
- Pode ser instalado na tela inicial (PWA).

Cotações: [open.er-api.com](https://www.exchangerate-api.com/docs/free) (atualizadas uma vez por dia),
com [fawazahmed0/currency-api](https://github.com/fawazahmed0/exchange-api) como reserva. Nenhuma chave de API é necessária.

## Rodar localmente

Não há build. Basta servir a pasta:

```sh
python3 -m http.server 8000
```

e abrir <http://localhost:8000>.

## Publicar (GitHub Pages)

1. Em **Settings → Pages**, em *Source*, escolha **GitHub Actions**.
2. Faça push para a branch `main` (ou rode o workflow manualmente em **Actions**).
3. O app fica em `https://<usuario>.github.io/money_converter/`.

## Instalar no celular

- **Android (Chrome):** menu ⋮ → *Adicionar à tela inicial* / *Instalar app*.
- **iPhone (Safari):** botão Compartilhar → *Adicionar à Tela de Início*.
