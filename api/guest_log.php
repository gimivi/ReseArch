<?php
// api/guest_log.php — registro degli accessi degli OSPITI (tabella guest_access_log).
// Gli ospiti non sono nella tabella users (_doc/arch-sso-ospiti.md §3.3-§3.4): qui resta chi è entrato,
// da dove e cosa ha aperto. Conservato 12 mesi (Manutenzione database).
//   ra_guest_log('research', $resId)   — da chiamare dove l'ospite apre qualcosa
// Per gli utenti che non sono ospiti non fa nulla. Un errore di scrittura non blocca la pagina.
declare(strict_types=1);

if (!function_exists('ra_guest_log')) {
    function ra_guest_log(string $event, ?int $refId = null): void {
        global $pdo;
        $u = $_SESSION['user'] ?? null;
        if (!is_array($u) || empty($u['guest']) || !($pdo instanceof PDO)) return;
        $ip = (string)($_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '');
        $ip = trim(explode(',', $ip)[0]);
        try {
            $pdo->prepare("INSERT INTO guest_access_log (provider, subject, display_name, email, ip, event, ref_id)
                           VALUES (?, ?, ?, ?, ?, ?, ?)")
                ->execute([
                    (string)($u['provider'] ?? ''), (string)($u['subject'] ?? ''),
                    mb_substr((string)($u['first_name'] ?? ''), 0, 190), mb_substr((string)($u['email'] ?? ''), 0, 190),
                    mb_substr($ip, 0, 45), $event, $refId,
                ]);
        } catch (Throwable $e) {
            error_log('guest_log: ' . $e->getMessage());
        }
    }
}
