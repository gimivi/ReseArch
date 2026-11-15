<?php
// verify_email.php

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
require_once __DIR__ . '/api/db.php';
require_once __DIR__ . '/api/i18n.php';
ra_i18n_set_research(null);

$token = isset($_GET['token']) ? trim($_GET['token']) : '';
$verificationMessage = '';

if ($token === '') {
    $verificationMessage = t('verify.invalid_link');
} else {
    try {
        $stmt = $pdo->prepare('
            SELECT evt.id AS token_id, evt.user_id, evt.expires_at, evt.used_at, u.is_verified
            FROM email_verification_tokens evt
            JOIN users u ON u.id = evt.user_id
            WHERE evt.token = :token
            LIMIT 1
        ');
        $stmt->execute([':token' => $token]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$row) {
            $verificationMessage = t('verify.invalid_token');
        } else {
            $now       = new DateTime();
            $expiresAt = new DateTime($row['expires_at']);

            if ($row['used_at'] !== null) {
                $verificationMessage = t('verify.used');
            } elseif ($now > $expiresAt) {
                $verificationMessage = t('verify.expired');
            } else {
                $pdo->beginTransaction();

                if ((int)$row['is_verified'] === 0) {
                    $stmtUser = $pdo->prepare('
                        UPDATE users
                        SET is_verified = 1
                        WHERE id = :user_id
                    ');
                    $stmtUser->execute([':user_id' => $row['user_id']]);
                }

                $stmtToken = $pdo->prepare('
                    UPDATE email_verification_tokens
                    SET used_at = NOW()
                    WHERE id = :token_id
                ');
                $stmtToken->execute([':token_id' => $row['token_id']]);

                $pdo->commit();

                $verificationMessage = t('verify.success');
            }
        }

    } catch (Exception $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('Email verification error: ' . $e->getMessage());
        $verificationMessage = t('errors.internal');
    }
}
?>
<?php $pageTitle = t('verify.page_title'); ?>
<!DOCTYPE html>
<html lang="<?= htmlspecialchars(ra_lang()) ?>">
<head>
<?php require __DIR__ . '/partials/head.php'; ?>
</head>
<body class="bg-light">
<?php require __DIR__ . '/partials/login_bg.php'; // sfondo generativo, icone, lente braille ?>
<main class="flex-grow-1 d-flex">
<div class="container d-flex align-items-center justify-content-center py-4">
    <div class="card shadow-sm" style="max-width: 400px; width: 100%;">
        <div class="card-body text-center">
            <h1 class="text-center mb-2">
                <img src="img/Logo_Research.svg" alt="<?= te('app.name') ?>" width="128" height="128" data-braille-haptics>
            </h1>
            <h2 class="h6 mb-3"><?= te('verify.page_title') ?></h2>

            <p class="mb-3" role="status">
                <?php echo htmlspecialchars($verificationMessage, ENT_QUOTES, 'UTF-8'); ?>
            </p>

            <a href="index.php" class="btn btn-primary"><?= te('verify.go_login') ?></a>
        </div>
    </div>
</div>
</main>
<?php require __DIR__ . '/partials/a11y_footer.php'; ?>
</body>
</html>
