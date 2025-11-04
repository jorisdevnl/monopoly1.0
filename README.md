# Monopoly Node + Socket.IO Prototype (Income Tax 10% & Free Parking jackpot)

Deze versie implementeert:
- Income Tax = 10% van nettowaarde (vak 4). Bedrag gaat naar Free Parking-pot.
- Luxury Tax = €75 (vak 38). Bedrag gaat naar Free Parking-pot.
- Free Parking (vak 20) geeft de hele pot aan de speler die erop landt (jackpot).
- Huizen, veilingen en basis multiplayer via Socket.IO blijven aanwezig.

Quick start:
1. Node.js 16+ installeren.
2. npm install
3. npm start
4. Open meerdere browsers naar: http://localhost:3000
5. Maak of join dezelfde kamer en speel.

Opmerkingen:
- Nettowaarde is hier: contant + prijs van eigendommen + waarde van huizen op die eigendommen.
- Faillissementslogica en huisvoorraadlimieten (32 huizen / 12 hotels) zijn nog simplistisch of niet volledig gemodelleerd in deze MVP.
- Uitbreidingen (suggesties): persistente opslag, volledige mortgage/logica, exacte huis/hotel voorraden en betere UI voor veilingen en meldingen.
