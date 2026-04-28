# ─────────────────────────────────────────────────────────────────────────────
# DEPLOYMENT GUIDE
# ─────────────────────────────────────────────────────────────────────────────

## Option 1: Railway (Easiest — recommended to start)
# 1. Push this folder to a GitHub repo
# 2. Go to railway.app → New Project → Deploy from GitHub
# 3. Set environment variables in Railway dashboard (same as .env)
# 4. Done. Railway gives you a public URL like https://tcg-tracker.up.railway.app

## Option 2: DigitalOcean Droplet (~$6/mo, most control)
# 1. Create a Ubuntu droplet
# 2. SSH in and run:

#    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
#    sudo apt-get install -y nodejs
#    npm install -g pm2
#
#    git clone your-repo /home/ubuntu/tcg-tracker
#    cd /home/ubuntu/tcg-tracker
#    npm install
#    npx playwright install chromium --with-deps
#    cp .env.example .env && nano .env   # fill in your values
#
#    pm2 start ecosystem.config.js
#    pm2 save
#    pm2 startup   # follow the printed instructions

## Option 3: Render (free tier available, but sleeps after 15min inactivity)
# Good for testing, not production
