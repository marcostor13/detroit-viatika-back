# --- Configuración ---
$IMAGE_NAME = 'viatika-back'
$SshUser = "marcostor13"
$Ec2Host = "192.168.100.29"
$Ec2Host = "ssh.marcostorresalarcon.com"

# 1. (NUEVO) Define la ruta del proyecto en el servidor remoto
$RemoteProjectPath = "/home/$SshUser" 

$RemoteScriptPath = "./deploy.sh"
$ImageName = "marcostor13/$IMAGE_NAME"
$ContainerName = "viatika-back"
$HostPort = "3016"
$enviromentsFile = ".env_viatika"


# --- Pasos Locales (Build & Push) ---
Write-Host "BUILDING IMAGE LOCALLY"
docker build -t $IMAGE_NAME .

Write-Host "TAGGING IMAGE"
docker tag $IMAGE_NAME "marcostor13/$IMAGE_NAME"

Write-Host "PUSHING IMAGE TO DOCKER HUB"
docker push "marcostor13/$IMAGE_NAME"


# --- Pasos Remotos (SSH & Deploy) ---
Write-Host "Conectando a $SshUser@$Ec2Host y ejecutando script remoto..."

# 2. (MODIFICADO) El comando ahora incluye 'cd' para moverse al directorio correcto primero.
#    El '&&' asegura que el script solo se ejecute si el 'cd' fue exitoso.
$RemoteCommand = "cd $RemoteProjectPath && $RemoteScriptPath $ImageName $ContainerName $HostPort $enviromentsFile"

$SshCommandArgs = @(
    "$SshUser@$Ec2Host",
    $RemoteCommand
)
Write-Host "Comando SSH a ejecutar:"
Write-Host "ssh $SshUser@$Ec2Host ""$RemoteCommand""" # Muestra el comando completo para depuración


# Ejecutar el comando SSH
& ssh $SshCommandArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host "Script remoto ejecutado exitosamente (codigo de salida $LASTEXITCODE)."
} else {
    Write-Error "El comando SSH o el script remoto fallaron con código de salida: $LASTEXITCODE"
    Write-Host "Revisa la salida anterior para ver los errores específicos del script remoto."
}

Write-Host "--- Script PowerShell Finalizado ---"