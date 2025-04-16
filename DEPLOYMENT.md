# Deploying Frame Reader to flibbidy.com

This guide will walk you through deploying the Frame Reader application to your domain flibbidy.com hosted on Namecheap.

## Prerequisites

1. A server (VPS) running Linux (Ubuntu 20.04 or newer recommended)
2. SSH access to your server
3. Your domain (flibbidy.com) already purchased on Namecheap
4. Basic knowledge of terminal commands

## Step 1: Point Domain to Your Server

1. Log in to your Namecheap account
2. Go to Domain List and select flibbidy.com
3. Click "Manage"
4. Go to "Advanced DNS"
5. Add/update the following records:
   - Type: A Record, Host: @, Value: [Your Server IP], TTL: Automatic
   - Type: A Record, Host: www, Value: [Your Server IP], TTL: Automatic
6. Save changes and wait for DNS propagation (can take up to 24-48 hours)

## Step 2: Prepare the Server

SSH into your server and run the following commands:

```bash
# Update system packages
sudo apt update
sudo apt upgrade -y

# Install required dependencies
sudo apt install -y python3 python3-venv python3-pip nginx certbot python3-certbot-nginx

# Create directory for application
sudo mkdir -p /var/www/frame-reader
sudo chown -R $USER:$USER /var/www/frame-reader
```

## Step 3: Upload and Set Up the Application

You can use SCP or rsync to upload your application files:

```bash
# From your local machine
rsync -av --exclude venv --exclude __pycache__ --exclude .git ./ username@your_server_ip:/var/www/frame-reader/
```

Or clone from a git repository if your code is in one:

```bash
# On your server
cd /var/www/frame-reader
git clone YOUR_REPOSITORY_URL .
```

## Step 4: Configure the Application

```bash
# On your server
cd /var/www/frame-reader

# Set up a virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Make sure upload directories exist
mkdir -p uploads/logs uploads/audio
```

## Step 5: Configure Nginx

```bash
# Edit the nginx configuration file and set the correct path
sudo nano /etc/nginx/sites-available/flibbidy.com

# Copy the contents from flibbidy.com.nginx.conf
# Update the "/path/to/your/app/static" with "/var/www/frame-reader/static"

# Enable the site
sudo ln -s /etc/nginx/sites-available/flibbidy.com /etc/nginx/sites-enabled/
sudo nginx -t  # Test the configuration
sudo systemctl restart nginx
```

## Step 6: Set Up SystemD Service

```bash
# Edit the service file
sudo nano /etc/systemd/system/frame-reader.service

# Copy the contents from frame-reader.service
# Update paths:
# - WorkingDirectory=/var/www/frame-reader
# - ExecStart=/var/www/frame-reader/venv/bin/gunicorn ...

# Enable and start the service
sudo systemctl daemon-reload
sudo systemctl enable frame-reader
sudo systemctl start frame-reader
sudo systemctl status frame-reader  # Check if running correctly
```

## Step 7: Secure with HTTPS (SSL)

```bash
# Obtain SSL certificate
sudo certbot --nginx -d flibbidy.com -d www.flibbidy.com

# Follow the prompts to complete
# Certbot will automatically update your Nginx configuration
```

## Step 8: Test Your Deployment

Visit https://flibbidy.com in your browser. Your Frame Reader application should be up and running!

## Troubleshooting

### Check Application Logs
```bash
sudo journalctl -u frame-reader.service -f
```

### Check Nginx Logs
```bash
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log
```

### Restart Services After Changes
```bash
sudo systemctl restart frame-reader
sudo systemctl restart nginx
```

## Security Considerations

1. Consider adding basic authentication to protect your application
2. Set up a firewall (UFW) to only allow necessary ports
3. Keep your server updated regularly
4. Set up automated backups of your application data

## Maintenance

### Updating the Application
```bash
cd /var/www/frame-reader
git pull  # If using git

# Activate venv and install any new dependencies
source venv/bin/activate
pip install -r requirements.txt

# Restart the service
sudo systemctl restart frame-reader
```

### SSL Certificate Renewal
Certbot installs a timer that will renew certificates automatically. You can check its status with:
```bash
sudo systemctl status certbot.timer
``` 