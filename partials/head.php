<?php
/*
 * partials/head.php — contenuto del <head> comune alle pagine pubbliche
 * (index.php, register.php, account.php, verify_email.php).
 * Prima di includerlo: require_once api/i18n.php e $pageTitle (testo già tradotto).
 */
?>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= htmlspecialchars($pageTitle ?? '') ?> | <?= te('app.name') ?></title>

    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
          rel="stylesheet"
          integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH"
          crossorigin="anonymous">
    <!-- Fondamenta visive della piattaforma (token, carattere, focus): css/ReseArch.css §0 -->
    <link rel="stylesheet" href="css/ReseArch.css">

    <?= ra_i18n_head() ?>
