param(
    $File = $(throw "Input file required"),
    $Out = "out"
)

$cellCounts = @(64, 128, 256, 512, 1024, 2048)

foreach ($cellCount in $cellCounts)
{
    $outputDir = $Out + "_" + $cellCount
    $outputPath = $outputDir + "/"
    if (Test-Path -Path $outputPath)
    {
        echo "$outputPath already exists, skipping"
    }
    else
    {
        New-Item -Path . -Name $outputDir -ItemType 'directory' > $null
        echo "Created $outputPath, running..."

        $args = @($File, '-e', '-n', '-s', 'none', '-o', $outputPath, '-c', $cellCount)
        & "python" "generate_block_mesh.py" $args
        # Start-Process -FilePath "python" -ArgumentList "generate_block_mesh.py" $args
    }
}