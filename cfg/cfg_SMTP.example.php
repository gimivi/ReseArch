<?php
// cfg/cfg_SMTP.example.php — MODELLO del server di posta per le email della piattaforma
// (verifica dell'indirizzo, recupero password, invii dagli amministratori).
// Copiarlo in cfg/cfg_SMTP.php (escluso da git: contiene la password) e compilarlo.
// L'account indicato in 'user' è anche il mittente delle email.
return [
    'host' => '',     // es. smtps.dominio.it
    'user' => '',     // es. noreply@dominio.it
    'pass' => '',
    'port' => 465     // 465 = SSL, 587 = STARTTLS
];
