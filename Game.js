export const TILE_EMPTY = 0;

export class Player {
    constructor(id, x, y, dirX, dirY, color) {
        this.id = id;
        this.color = color;
        this.x = x; // Logical continuous position X
        this.y = y; // Logical continuous position Y
        this.dirX = dirX; // Movement direction X (-1, 0, 1)
        this.dirY = dirY; // Movement direction Y (-1, 0, 1)
        this.speed = 8.0; // Grid cells per second
        this.isAlive = true;
        this.score = 0; // Number of cells owned
        this.kills = 0; // Kills tracker for points system

        // Track the path of cells currently making up their active trail
        this.currentTrail = [];

        // Powerups
        this.extraLives = 0;
        this.hasSword = false;
    }
}

export class GameEngine {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.grid = new Uint8Array(width * height); // 0 = empty, 1-100 = players, 101-200 = trails
        this.players = new Map();

        this.powerups = []; // { id: num, x, y, type: 'crown'|'sword' }
        this.projectiles = []; // { x, y, dirX, dirY, ownerId, speed }

        this.powerupIdCounter = 0;

        // Events
        this.onCellsUpdated = (cells) => { }; // Called with [{x,y,val}] to update texture efficiently
        this.onPlayerDied = (pid) => { };
        this.onPowerupSpawned = (p) => { };
        this.onPowerupCollected = (pId, playerId) => { };
        this.onProjectileSpawned = (proj) => { };
        this.onProjectileRemoved = (projId) => { };
        this.onGameOver = (winnerId) => { }; // Call when game ends
    }

    getIndex(x, y) {
        return y * this.width + x;
    }

    getCoord(index) {
        return { x: index % this.width, y: Math.floor(index / this.width) };
    }

    addPlayer(id, x, y, color) {
        const p = new Player(id, x, y, 0, -1, color);
        this.players.set(id, p);

        // Start them with a 3x3 territory
        const updates = [];
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const cx = Math.floor(x) + dx;
                const cy = Math.floor(y) + dy;
                if (cx >= 0 && cx < this.width && cy >= 0 && cy < this.height) {
                    this.grid[this.getIndex(cx, cy)] = id;
                    updates.push({ x: cx, y: cy, val: id });
                    p.score++;
                }
            }
        }
        this.onCellsUpdated(updates);
    }

    setPlayerDirection(id, dx, dy) {
        const p = this.players.get(id);
        if (!p || !p.isAlive) return;
        // Don't allow reversing direction directly
        if (p.dirX === -dx && p.dirY === -dy && (dx !== 0 || dy !== 0)) return;

        p.dirX = dx;
        p.dirY = dy;
    }

    fireProjectile(id) {
        const p = this.players.get(id);
        if (!p || !p.isAlive || !p.hasSword) return;

        p.hasSword = false;

        // Ensure projectile fires in a valid moving direction. If stopped, default to up.
        let dx = p.dirX;
        let dy = p.dirY;
        if (dx === 0 && dy === 0) { dy = 1; }

        const proj = {
            id: Math.random().toString(36).substr(2, 9),
            x: p.x + dx,
            y: p.y + dy,
            dirX: dx,
            dirY: dy,
            ownerId: p.id,
            speed: 15.0 // fast!
        };
        this.projectiles.push(proj);
        this.onProjectileSpawned(proj);
    }

    spawnPowerup(type, x, y) {
        const p = {
            id: this.powerupIdCounter++,
            x: Math.floor(x),
            y: Math.floor(y),
            type: type
        };
        this.powerups.push(p);
        this.onPowerupSpawned(p);
    }

    update(dt) {
        const updates = [];

        for (const [id, p] of this.players) {
            if (!p.isAlive) continue;

            const prevCellX = Math.floor(p.x);
            const prevCellY = Math.floor(p.y);

            // Apply speed malus in enemy territory
            let currentSpeed = p.speed;
            const currentCellVal = this.grid[this.getIndex(prevCellX, prevCellY)];
            if (currentCellVal > 0 && currentCellVal <= 100 && currentCellVal !== p.id) {
                currentSpeed = p.speed * 0.45; // 55% movement speed reduction in enemy territory!
            }

            p.x += p.dirX * currentSpeed * dt;
            p.y += p.dirY * currentSpeed * dt;

            // Clamp to map boundaries
            p.x = Math.max(0, Math.min(this.width - 0.01, p.x));
            p.y = Math.max(0, Math.min(this.height - 0.01, p.y));

            const currCellX = Math.floor(p.x);
            const currCellY = Math.floor(p.y);

            // Process Powerup Collection
            for (let i = this.powerups.length - 1; i >= 0; i--) {
                const pu = this.powerups[i];
                // Check continuous distance with a tighter hitbox (0.6 instead of 1.0)
                if (Math.abs(p.x - pu.x) < 0.6 && Math.abs(p.y - pu.y) < 0.6) {

                    let collected = false;
                    if (pu.type === 'crown') {
                        p.extraLives = 1; // Max 1 extra life
                        collected = true;
                    }
                    else if (pu.type === 'sword') {
                        p.hasSword = true; // Max 1 sword
                        collected = true;
                    }

                    if (collected) {
                        this.onPowerupCollected(pu.id, p.id, pu.type);
                        this.powerups.splice(i, 1);
                    }
                }
            }

            // Did we cross into a new grid cell?
            if (currCellX !== prevCellX || currCellY !== prevCellY) {
                this.handleCellEntry(p, currCellX, currCellY, updates);
            }
        }

        // Update Projectiles
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const proj = this.projectiles[i];

            proj.x += proj.dirX * proj.speed * dt;
            proj.y += proj.dirY * proj.speed * dt;

            const cx = Math.floor(proj.x);
            const cy = Math.floor(proj.y);

            // Bounds check
            if (cx < 0 || cx >= this.width || cy < 0 || cy >= this.height) {
                this.onProjectileRemoved(proj.id);
                this.projectiles.splice(i, 1);
                continue;
            }

            const idx = this.getIndex(cx, cy);
            const cellVal = this.grid[idx];

            let hit = false;

            // Hit an active trail? Cut it!
            if (cellVal > 100 && cellVal !== proj.ownerId + 100) {
                // We carve a hole here by setting it to 0
                this.grid[idx] = 0;
                updates.push({ x: cx, y: cy, val: 0 });

                // We must also slice the actual array of the player whose trail was cut
                const victimId = cellVal - 100;
                const victim = this.players.get(victimId);
                if (victim) {
                    victim.currentTrail = victim.currentTrail.filter(t => t.x !== cx || t.y !== cy);
                }

                hit = true;
            }

            // Hit another player directly?
            for (const [id, p] of this.players) {
                if (p.isAlive && id !== proj.ownerId) {
                    const px = Math.floor(p.x);
                    const py = Math.floor(p.y);
                    if (px === cx && py === cy) {
                        this.killPlayer(id, updates);
                        hit = true;
                    }
                }
            }

            if (hit) {
                this.onProjectileRemoved(proj.id);
                this.projectiles.splice(i, 1);
            }
        }

        if (updates.length > 0) {
            this.onCellsUpdated(updates);
            this.checkWinConditions();
        }
    }

    handleCellEntry(p, cx, cy, updates) {
        const idx = this.getIndex(cx, cy);
        const cellVal = this.grid[idx];

        // 1. Did we hit someone's trail (or our own?)
        if (cellVal > 100) {
            const trailOwnerId = cellVal - 100;
            // If they cross their own trail, it's suicide!
            if (trailOwnerId === p.id) {
                this.killPlayer(p.id, updates, null);
            } else {
                // We cut someone else's trail, THEY die!
                this.killPlayer(trailOwnerId, updates, p.id);
            }
            return;
        }

        // 2. Are we entering enemy SOLID territory?
        // We used to block this if our score was lower. Now everyone can invade anyone, 
        // but they suffer a speed penalty (handled in update(dt)).
        if (cellVal > 0 && cellVal <= 100 && cellVal !== p.id) {
            // Speed penalty applied elsewhere.
        }

        // 3. Are we outside our territory? (Empty space or invadable enemy space)
        if (cellVal !== p.id) {
            // Add to trail
            p.currentTrail.push({ x: cx, y: cy });
            this.grid[idx] = p.id + 100; // Mark as trail
            updates.push({ x: cx, y: cy, val: p.id + 100 });
        }
        // 3. We are inside our territory
        else {
            // Did we just return from a trail?
            if (p.currentTrail.length > 0) {
                this.captureTerritory(p, updates);
                p.currentTrail = [];
            }
        }
    }

    captureTerritory(p, updates) {
        // Simple bounding box of the trail to optimize flood fill
        let minX = this.width, maxX = 0, minY = this.height, maxY = 0;
        let captureCount = 0; // Track how many tiles we capture in this sweep

        // Convert trail to solid territory first
        for (const t of p.currentTrail) {
            this.grid[this.getIndex(t.x, t.y)] = p.id;
            updates.push({ x: t.x, y: t.y, val: p.id });
            p.score++;
            captureCount++;

            if (t.x < minX) minX = t.x;
            if (t.x > maxX) maxX = t.x;
            if (t.y < minY) minY = t.y;
            if (t.y > maxY) maxY = t.y;
        }

        // To find enclosed areas, the standard Paper.io way is to flood fill from the bounding box + 1 outwards finding all cells NOT owned by the player.
        // Everything not reached by the flood fill inside the bounding box is captured!

        // Expand bounding box slightly (clamp to map)
        minX = Math.max(0, minX - 1);
        maxX = Math.min(this.width - 1, maxX + 1);
        minY = Math.max(0, minY - 1);
        maxY = Math.min(this.height - 1, maxY + 1);

        const visited = new Uint8Array(this.width * this.height);
        const queue = [];

        // Seed the queue with the perimeter of the bounding box
        for (let x = minX; x <= maxX; x++) {
            queue.push({ x: x, y: minY });
            queue.push({ x: x, y: maxY });
            visited[this.getIndex(x, minY)] = 1;
            visited[this.getIndex(x, maxY)] = 1;
        }
        for (let y = minY + 1; y < maxY; y++) {
            queue.push({ x: minX, y: y });
            queue.push({ x: maxX, y: y });
            visited[this.getIndex(minX, y)] = 1;
            visited[this.getIndex(maxX, y)] = 1;
        }

        // Flood fill: find all cells connected to the perimeter that are NOT owned by the player
        let head = 0;
        while (head < queue.length) {
            const curr = queue[head++];
            const cIdx = this.getIndex(curr.x, curr.y);

            // If it's owned by the player, it acts as a wall blocking the outside fill.
            if (this.grid[cIdx] === p.id) {
                continue;
            }

            // Otherwise, it's an "outside" cell.
            // Check neighbors
            const neighbors = [
                { x: curr.x + 1, y: curr.y }, { x: curr.x - 1, y: curr.y },
                { x: curr.x, y: curr.y + 1 }, { x: curr.x, y: curr.y - 1 }
            ];

            for (const n of neighbors) {
                if (n.x >= minX && n.x <= maxX && n.y >= minY && n.y <= maxY) {
                    const nIdx = this.getIndex(n.x, n.y);
                    if (!visited[nIdx]) {
                        visited[nIdx] = 1;
                        queue.push(n);
                    }
                }
            }
        }

        // Now, scan the bounding box. Anything not visited and not already owned by Player becomes territory!
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const idx = this.getIndex(x, y);
                if (!visited[idx] && this.grid[idx] !== p.id) {
                    // Capture!

                    // If capturing another player's territory, reduce their score (Wait, keeping track of scores perfectly means decrementing old owner)
                    const oldOwner = this.grid[idx];
                    if (oldOwner > 0 && oldOwner <= 100 && oldOwner !== p.id) {
                        const oldP = this.players.get(oldOwner);
                        if (oldP) oldP.score--;
                    }

                    // If we capture a trail, that player dies and we get a kill score!
                    if (oldOwner > 100 && oldOwner !== (p.id + 100)) {
                        this.killPlayer(oldOwner - 100, updates, p.id);
                    }

                    this.grid[idx] = p.id;
                    p.score++;
                    captureCount++;
                    updates.push({ x, y, val: p.id });
                }
            }
        }

        // Let main know how many tiles were captured in this single action
        if (captureCount > 0 && this.onTerritoryCaptured) {
            this.onTerritoryCaptured(p.id, captureCount);
        }
    }

    killPlayer(pid, updates, killerId = null) {
        const p = this.players.get(pid);
        if (!p || !p.isAlive) return;

        // Extra Life Mechanic (Crown)
        if (p.extraLives > 0) {
            p.extraLives--;
            p.currentTrail = []; // Reset trail

            // Re-assert a small 3x3 territory around their current position to save them!
            const cx = Math.floor(p.x);
            const cy = Math.floor(p.y);

            // First, scrub the map of any of their trails
            for (let i = 0; i < this.grid.length; i++) {
                if (this.grid[i] === pid + 100) {
                    this.grid[i] = 0;
                    const pos = this.getCoord(i);
                    updates.push({ x: pos.x, y: pos.y, val: 0 });
                }
            }

            // Then give them a safe bubble OR warp them home
            let foundHome = false;
            for (let i = 0; i < this.grid.length; i++) {
                if (this.grid[i] === pid) {
                    const pos = this.getCoord(i);
                    p.x = pos.x;
                    p.y = pos.y;
                    foundHome = true;
                    break;
                }
            }

            if (!foundHome) {
                // Fallback: they literally have no territory left, save them here
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const rx = cx + dx;
                        const ry = cy + dy;
                        if (rx >= 0 && rx < this.width && ry >= 0 && ry < this.height) {
                            const rIdx = this.getIndex(rx, ry);
                            if (this.grid[rIdx] !== pid) {
                                const oldOwner = this.grid[rIdx];
                                if (oldOwner > 0 && oldOwner <= 100) {
                                    const oldP = this.players.get(oldOwner);
                                    if (oldP) oldP.score--;
                                }
                                this.grid[rIdx] = pid;
                                p.score++;
                                updates.push({ x: rx, y: ry, val: pid });
                            }
                        }
                    }
                }
            }
            if (this.onExtraLifeUsed) this.onExtraLifeUsed(pid, p.extraLives);
            return; // Survived!
        }

        p.isAlive = false;

        // Clear their territory and trails
        for (let i = 0; i < this.grid.length; i++) {
            if (this.grid[i] === pid || this.grid[i] === pid + 100) {
                this.grid[i] = 0;
                const pos = this.getCoord(i);
                updates.push({ x: pos.x, y: pos.y, val: 0 });
            }
        }

        p.score = 0;
        p.currentTrail = [];

        if (killerId !== null) {
            const killer = this.players.get(killerId);
            if (killer) killer.kills++;
        }

        this.onPlayerDied(pid);

        this.checkWinConditions();
    }

    checkWinConditions() {
        let aliveCount = 0;
        let lastAliveId = null;
        let highestScoreId = null;

        const TOTAL_MAP_CELLS = this.width * this.height;

        for (const [id, p] of this.players) {
            if (p.isAlive) {
                aliveCount++;
                lastAliveId = id;

                // Territory 50% Win
                if (p.score / TOTAL_MAP_CELLS >= 0.5) {
                    highestScoreId = id;
                }
            }
        }

        if (highestScoreId !== null) {
            this.onGameOver(highestScoreId);
        } else if (aliveCount === 1 && lastAliveId !== null) {
            this.onGameOver(lastAliveId);
        }
    }
}
