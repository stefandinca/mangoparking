Minor tweaks:

1. Rename "Cumpara Credite" in "Rezerva parcare navetisti" on the homepage and booking page

2. Add a whatsapp floating button on the bottom-right of every page

New features or more complex work:



1. I want to create a custom date / time picker. the system one looks ugly. Create a custom date/time picker in the style of the website. Hours should be in 24h format, no AM/PM. And clicking the date field anywhere should open the date/time picker (currently it opens only when clicking the icon)

2. on the persoana juridica form we need:
    - CNP / serie CI or Passport number
    - Nume
    - Prenume
    - Adresa
    - Nume firma
    - CUI (is there a chance to automatically pull data based on the CUI? )
    - Nr. Reg. Com. (optional)
    - Adresa firma

3. I want to setup automated emails for: account creation, long-term parking reservation, 24h before long-term parking check-in and 24h before check-out, credit transaction (when buying credits and when using credits), at 7PM auto reminder for navetisti (if they were checked in that day but not checked out yet), the cutoff is 8PM. plus recover password email, low credit warning email (when 2 credits remain)

users should have the option to pay on pick-up (both long-term and naveta). When choosing this option, when we send the confirmation email, there should me a message encouraging them to pay online and receive the 10% (or whatever value is set in the admin) discount.

4. As an admin I want to be able to create accounts for users with email/password or set up an automated invite email message they can use to create an account. I also want to be able to give users credits, when they pay directly at the location.

5. As an admin I want to see a check-in/check-out dashboard for cars. It should contain:
    - reservation number
    - car number (B-00-XXX)
    - Check-in date/time (green flag if it's been paid in advance / red flag if not yet paid)
    - check-out date/time.
    
    - the ability to check-in/out cars manually.
    - the flow should work like this: 
        - for long term parking, John goes on the website, reserves a spot, arrives at the parking lot LPR camera scans his car number (this is for the future, not yet implemented). He then walks to the shuttle, the driver asks for his car number or reservation number and checks him in manually (will be switched to auto check-in when we install the camera), if everything is paid, he walks on the shuttle which takes him to the airport. When he comes back, before taking him back to the parking lot, the shuttle driver again asks for his reservation or car number and checks him out manually.

        - for navetisti: John goes on the website and buys credits with the option to pay at the parking lot cash/card. He arrives, the camera scans his number (in the future, not yet implemented), he then walks over to the shuttle driver. the driver asks for his car number, sees that he hasn't paid his credits yet and asks for payment. After John pays, the driver can check him in manually and a credit is deducted for the day.can

