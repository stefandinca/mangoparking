1. review the UX for no show booking flow. Does it work correctly? I tested some long term parking bookings that were not paid/checked in within 24 hours and they still show up in the check-in tab, instead of the No show tab.

2. When doing walk-ins, the first step is payment then check-in. You shouldn't be able to check in a client that is not paid. When entering dates for walk-ins, the system should compute the price and let admins add to the price if needed.

3. Some users were confused by the "Long term rates" section. they thought those 1-3 days, 4-7 days elements were buttons. Make that section look less like something that's selectable and more like it's information.

4. When trying to create walk-in -> existing client -> sell credits (5) -> paid cash, i get these internal errors: urope-west1-mango-parking.cloudfunctions.net/grantCreditsForCash:1  Failed to load resource: the server responded with a status of 500 ()
CreateTransactionModal-Dj1_Vduy.js:145 createTransaction FirebaseError: INTERNAL

Other feedback from the client:

Feedback Website & Dashboard 
  1. UI / Design vizual  
Aspect general & spațiere
    • Spațierea dintre secțiuni este inconsistentă — există goluri foarte mari în unele zone; de revizuit 
    • Modificare culori: unde apare galben pe galben textul nu se vede — de corectat contrastul
    • Butoanele trebuie să fie mai mari, toate aceeași culoare și aliniate pe partea stângă
    • Fontul de pe butoane să fie mai mare
    • Toate textele se aliniază din stânga
    • Numele ManGO să fie scris consistent everywhere: Man + GO cu majusculă 
Iconițe
    • Iconița pentru 'Parcare Navetisti' să includă siluete umane ceva
    • Iconița pentru 'Termen Lung' să fie un avion
  2. Componente specifice de pagină  
Secțiunea 'Totul inclus'
    • Beneficiile din această rubrică să devină slides (carousel), nu listă statică, ca sunt doar 3 chestii, sau mai adaugam una ca sa fie cumva frumos vizual
Ratinguri
    • Înlocuirea liniuțelor cu stele (★) pentru afișarea ratingurilor ca humansii cred ca e slide
Programul de plecări (tren, microbuz etc.)
    • Lista este prea lungă — de implementat buton 'See more' / 'Vezi mai mult' cu expand/collapse, sau daca zice tefy, renuntam la ea? Idk, ca el zice ca mangobuzul se duce cu clientul cand vine clientul, nu dupa orarul trenului
Secțiunea 'Gata de plecare?'
    • Butonul/linkul să ducă direct la Google Maps, nu la pagina de info
    • Ordinea elementelor: 1. Maps → 2. Info Contact (ca sa ia cu copy paste daca e la volan) → 3. Formular (opțional — formularul poate fi scos, tu ce zici?)
Parcare Aeroport & Parcare Navetisti
    • Cele două carduri afișate unul sub altul să devină slides ? 
Secțiunea Tarife
    • Aspectul vizual al cardurilor de tarife— unele texte sunt foarte mici, de mărit și echilibrat, sa le indesam mai bine
    • De eliminat pătratele cu intervalele '1-3 zile', '4-7 zile' — creează confuzie, humansii nu anteleg de ce e clickuit unu din ele si ei nu il pot desclickui, plus nu prea le pasa de celelalte preturi
    • Reducerea de -10% online: mesajul actual lasă impresia că se adaugă peste prețul deja afișat — de reformulat clar că prețul afișat include deja reducerea online, sau de schimbat modul de afișare, idk dar 100% din cei ce au testat au facut confuzia asta
Butoanele 'Pasul următor'
    • Decizie de luat: butoanele să fie TOATE în interiorul chenarului (Cardului sau cum s-o chema patratele cu info) SAU TOATE în afara lui — 
'Următoarele plecări'
    • Dacă nu există link funcțional atașat, de eliminat comportamentul de click (cursor pointer) — creează așteptare falsă utilizatorului, toti au senzatia ca se mai deschide ceva
Secțiunea 'Credite'
    • De adăugat mai mult text explicativ introductiv — utilizatorii nu citesc descrierile de mai jos, mintea lor e lazy as f, ma intreaba pe mine
Informații de contact & facturare
    • De comasat cele două formulare într-unul singur, cu opțiunea 'Același cu datele de contact / rezervare' bifabilă
    • Detaliul '15 min frecvență autobuz' și '24/7 safe' — aia cu 15 min creca o scoatem  ca e fake news a la tefy, si 24/7 safe plm pus undeva ca o stampila sau scos si ala
Legal & GDPR
    • Politica de anulare și GDPR (politica de confidențialitate) trebuie să aibă checkbox-uri separate — nu pot fi bifate împreună – asa zice regula siteurilor or smth
  3. Dashboard — Funcționalități & Bug-uri  
Rezervări termen lung — Check-in
    • Clienții pe termen lung să nu poată face check-in dacă rezervarea nu apare ca 'Încasată' în sistem — de adăugat blocare sau mesaj de avertizare clar
Walk-in — Calculare preț
    • La introducerea datelor pentru walk-in, sistemul să precalculeze automat prețul total
    • De adăugat posibilitatea de a mai adauga ceva – sa modifici pretul
Walk-in — Credite (BUG)
    • Există o eroare la walk-in cu credite — 
Diferențierea tipurilor de rezervare
    • Rezervările din dashboard să fie vizual diferențiate pe tip. Propunere numerotare: LT0001 pentru termen lung, N0001 pentru navetisti
    • Alternativ: iconițe diferite pentru termen lung / navetisti / rezervări prepaid prin broker (ex. ParkVia)
Rezervări prin broker prepaid
    • De adăugat evidență separată pentru rezervările prin broker prepaid
    • NO-showurile, marcate cu no show rosu ceva, nu a venit bulangiul
Fereastra 'Încasează'
    • La deschiderea ferestrei de încasare nu apare suma de încasat — de afișat clar suma datorată,
Check-out clienți întârziați
    • La efectuarea check-out pentru un client întârziat sau care prelungeste, sistemul nu avertizează că există zile suplimentare de plată — de adăugat notificare cu suma rămasă de încasat înainte de finalizarea check-out-ului

