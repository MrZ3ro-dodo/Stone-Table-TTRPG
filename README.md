# Stone Plate

Mesa virtual para TTRPG. Abra `index.html` para acessar as ferramentas privadas do mestre: mapa, tokens, iniciativa, configurações, personagens e combate.

Na área **Configurações**, importe MP3s para a biblioteca local e ajuste a reprodução, afinação, velocidade, loop, reverberação e eco. Ao tocar uma faixa em uma sala, o áudio é enviado aos jogadores conectados e reproduzido nos navegadores deles; cada navegador precisa permitir áudio após uma interação inicial. Os arquivos ficam armazenados localmente no navegador do mestre. Use **Abrir tela dos jogadores** na seção de personagens para abrir `players.html` em outra janela. Mova essa janela para a segunda tela e projete-a manualmente. Os jogadores podem alternar entre o mapa e a tela de personagens; nenhum controle do mestre aparece nessa janela.

Personagens, mapa e iniciativa usam um estado único. Vincule um personagem pelo campo **Token do mapa**; projéteis com dano configurado reduzem a vitalidade do personagem atingido. O estado antigo é migrado automaticamente ao abrir o Stone Plate.

## Rolagem de dados

Dados padrão (d4 a d20) usam a física 3D de `@3d-dice/dice-box`. d30, d60 e d100 usam poliedros convexos quase esféricos, com 30, 60 e 100 faces triangulares; o resultado sorteado é destacado na face voltada para a câmera. A animação assenta no resultado escolhido pelo gerador criptográfico do app. Os renderizadores carregam sob demanda e requerem conexão à internet e WebGL; sem eles, o app usa a animação local existente. Moedas continuam nesse fallback. Os resultados são enviados aos demais clientes.