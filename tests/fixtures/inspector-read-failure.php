<?php
/** Supplies a stat-able archive whose native read fails deterministically. */
final class InspectorReadFailure
{
    /** @var resource|null Set by PHP when opening the stream. */
    public $context;

    /** @return array<string, int> */
    public function url_stat(string $path, int $flags): array
    {
        return ['mode' => 0100644, 'size' => 1];
    }

    public function stream_open(string $path, string $mode, int $options, ?string &$opened_path): bool
    {
        return false;
    }
}

if (!stream_wrapper_register('inspector-read-failure', InspectorReadFailure::class)) {
    throw new RuntimeException('Could not register the archive read-failure fixture.');
}
