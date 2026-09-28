import * as THREE from 'three';

/**
 * 3D 1090 Fruits - Skill Database & Execution Matrix
 * Defines the complete catalog of skills for all Fruits and Swords.
 */

export const SKILL_DATABASE = {
  // ==========================================================
  // 1. GRAVITY FRUIT (6 Skills)
  // ==========================================================
  gravity: {
    id: 'gravity',
    name: 'GRAVITY FRUIT',
    glyph: '🌌',
    color: '#b026ff',
    skills: [
      {
        id: 'asteroid',
        name: 'ASTEROID',
        key: 'Z',
        range: '25M AOE',
        baseCd: 2.0,
        desc: 'Drops a giant asteroid down to cursor position. Explodes at 25m radius, leaving a firepit for 10s dealing 3% tick damage.',
        cast: (ctx) => {
          const target = ctx.player.aimTarget.clone();
          target.y = 0;

          // Spawn asteroid high above
          const startPos = new THREE.Vector3(target.x, 80, target.z);
          const asteroidGeo = new THREE.DodecahedronGeometry(5.0, 1);
          const asteroidMat = new THREE.MeshStandardMaterial({
            color: 0x331122,
            emissive: 0xaa2200,
            roughness: 0.8
          });
          const asteroidMesh = new THREE.Mesh(asteroidGeo, asteroidMat);
          asteroidMesh.position.copy(startPos);
          ctx.scene.add(asteroidMesh);

          // Animate descent
          let elapsed = 0;
          const dropDuration = 0.55;
          const intervalId = setInterval(() => {
            elapsed += 0.03;
            const progress = elapsed / dropDuration;
            if (progress >= 1.0) {
              clearInterval(intervalId);
              ctx.scene.remove(asteroidMesh);

              // 25m explosion & physical debris
              ctx.explosions.createExplosion(target, 25.0, 'asteroid', 2.8);

              // Damage & Firepit
              const enemies = ctx.enemies.getEnemiesInRadius(target, 25.0);
              for (const e of enemies) {
                e.takeDamage(1200, false, 'fruit');
                e.applyStatus('burn', 10.0);
              }

              // Firepit visual disc
              ctx.spawnFirepit(target, 25.0, 10.0, 0.03);
            } else {
              asteroidMesh.position.lerpVectors(startPos, target, progress);
              asteroidMesh.rotation.x += 0.2;
              asteroidMesh.rotation.y += 0.3;
            }
          }, 30);
        }
      },
      {
        id: 'gravitational_pressure',
        name: 'GRAV PRESSURE',
        key: 'X',
        range: 'GLOBAL ARENA',
        baseCd: 4.0,
        desc: 'All enemies get sucked up to middle of arena then explodes. (+2% damage and radius per unit, max out at 2000%.)',
        cast: (ctx) => {
          const center = new THREE.Vector3(0, 8, 0);
          const allEnemies = ctx.enemies.enemies;
          const unitCount = allEnemies.length;

          // Calculate bonus damage and radius (+2% per unit, capped at 2000%)
          const bonusPercent = Math.min(20.0, 1.0 + unitCount * 0.02);
          const blastRadius = Math.min(60.0, 18.0 * bonusPercent);

          ctx.sound.playQuakeBoom();

          // Suction towards center
          for (const e of allEnemies) {
            e.applyKnockback(new THREE.Vector3().subVectors(center, e.mesh.position), 35.0);
          }

          // ONE-PIECE CINEMATIC: colossal gravity vortex sucking the arena in
          ctx.explosions.vortex(new THREE.Vector3(0, 0, 0), 0xb026ff, 30.0, 2.0);

          // Delay explosion at center
          setTimeout(() => {
            ctx.explosions.createExplosion(center, blastRadius, 'asteroid', 3.2);
            ctx.explosions.megaShockwave(new THREE.Vector3(0, 0, 0), Math.max(80, blastRadius * 1.6), 0xb026ff);
            for (const e of allEnemies) {
              const baseDmg = 900 * bonusPercent;
              e.takeDamage(baseDmg, true, 'fruit');
            }
          }, 650);
        }
      },
      {
        id: 'gravitational_lightning',
        name: 'GRAV LIGHTNING',
        key: 'C',
        range: '17M AOE',
        baseCd: 6.5,
        desc: 'Summons a purple pillar with rings stacked together rising up and strikes 8 bursts of overlapped purple lightning bolts (interval 0.25s). 12% chance for meteors.',
        cast: (ctx) => {
          const center = ctx.player.position.clone();
          center.y = 0;

          // 1. Purple pillar with stacked rings
          const pillarGeo = new THREE.CylinderGeometry(2, 2, 60, 16);
          const pillarMat = new THREE.MeshBasicMaterial({
            color: 0xb026ff,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending
          });
          const pillar = new THREE.Mesh(pillarGeo, pillarMat);
          pillar.position.set(center.x, 30, center.z);
          ctx.scene.add(pillar);

          setTimeout(() => {
            ctx.scene.remove(pillar);
            pillarMat.dispose();
          }, 800);

          // 8 bursts of overlapped purple lightning bolts
          let burstCount = 0;
          const burstInterval = setInterval(() => {
            burstCount++;
            if (burstCount > 8) {
              clearInterval(burstInterval);
              return;
            }

            const strikeTarget = center.clone().add(new THREE.Vector3(
              (Math.random() - 0.5) * 34,
              0,
              (Math.random() - 0.5) * 34
            ));

            ctx.lightning.strikeOverlapped(strikeTarget, 4, 3.5, 90, '#b026ff');
            ctx.explosions.createExplosion(strikeTarget, 6.0, 'lightning', 1.2);

            const hitEnemies = ctx.enemies.getEnemiesInRadius(strikeTarget, 8.0);
            for (const e of hitEnemies) {
              e.takeDamage(420, false, 'fruit');
            }

            // 12% chance to drop 1-5 small meteors
            if (Math.random() < 0.12) {
              const meteorCount = 1 + Math.floor(Math.random() * 5);
              for (let m = 0; m < meteorCount; m++) {
                const mPos = strikeTarget.clone().add(new THREE.Vector3((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10));
                ctx.explosions.createExplosion(mPos, 10.0, 'asteroid', 1.5);
              }
            }
          }, 250);
        }
      },
      {
        id: 'pressure_dereliction',
        name: 'PRESSURE ZONES',
        key: 'V',
        range: 'FOLLOW ENEMY',
        baseCd: 7.5,
        desc: 'Blasts out 7 pressure zones that explode 3 times every 0.5s following enemies.',
        cast: (ctx) => {
          const targets = ctx.enemies.enemies.slice(0, 7);
          if (targets.length === 0) return;

          for (const target of targets) {
            let explosionsDone = 0;
            const zoneTimer = setInterval(() => {
              explosionsDone++;
              if (explosionsDone > 3 || target.dead) {
                clearInterval(zoneTimer);
                return;
              }
              const p = target.mesh.position.clone();
              ctx.explosions.createExplosion(p, 12.0, 'asteroid', 1.6);
              target.takeDamage(650, false, 'fruit');
            }, 500);
          }
        }
      },
      {
        id: 'asteroid_rain',
        name: 'ASTEROID RAIN',
        key: 'B',
        range: '8 GIANT ASTEROIDS',
        baseCd: 10.0,
        desc: 'Drops 8 giant asteroids to random positions (interval 0.3s). Slam down, explodes 25m radius, firepit 10s dealing 5% tick damage.',
        cast: (ctx) => {
          let count = 0;
          const rainTimer = setInterval(() => {
            count++;
            if (count > 8) {
              clearInterval(rainTimer);
              return;
            }
            const dropPos = ctx.player.position.clone().add(new THREE.Vector3(
              (Math.random() - 0.5) * 90,
              0,
              (Math.random() - 0.5) * 90
            ));

            ctx.explosions.createExplosion(dropPos, 25.0, 'asteroid', 2.6);
            const enemies = ctx.enemies.getEnemiesInRadius(dropPos, 25.0);
            for (const e of enemies) {
              e.takeDamage(1400, false, 'fruit');
              e.applyStatus('burn', 10.0);
            }
            ctx.spawnFirepit(dropPos, 25.0, 10.0, 0.05);
          }, 300);
        }
      },
      {
        id: 'gravitational_punch',
        name: 'GRAV PUNCH',
        key: 'F',
        range: '10M KNOCK + 4x4 LIGHTNING',
        baseCd: 10.0,
        desc: 'Pulls and unleashes powerful charged punch knocking enemies 10m, strikes 4 rows of 4 overlapped purple lightning bolts upon landing. Intense positional camera shake.',
        cast: (ctx) => {
          // Intense camera shake
          ctx.cameraController.addShake(ctx.player.position, 3.5, 0.8);
          ctx.sound.playExplosion(1.0);

          // Punch forward
          const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), ctx.player.group.rotation.y);
          const punchPos = ctx.player.position.clone().addScaledVector(forward, 6.0);

          ctx.explosions.createExplosion(punchPos, 14.0, 'asteroid', 3.0);

          // Knockback enemies 10m
          const hitEnemies = ctx.enemies.getEnemiesInRadius(punchPos, 14.0);
          for (const e of hitEnemies) {
            e.applyKnockback(forward, 10.0);
            e.takeDamage(1800, true, 'fruit');
          }

          // Strikes 4 rows of 4 overlapped purple lightning bolts (strike burst interval 0.5s)
          let row = 0;
          const strikeTimer = setInterval(() => {
            row++;
            if (row > 4) {
              clearInterval(strikeTimer);
              return;
            }
            for (let col = 0; col < 4; col++) {
              const strikePos = punchPos.clone().add(new THREE.Vector3(
                (col - 1.5) * 6.0,
                0,
                row * 6.0
              ));
              ctx.lightning.strikeOverlapped(strikePos, 2, 2.0, 80, '#b026ff');
              ctx.explosions.createExplosion(strikePos, 5.0, 'lightning', 1.2);
            }
          }, 500);
        }
      }
    ]
  },

  // ==========================================================
  // 2. GRAVITY BLADE (Sword - 5 Skills + M1)
  // ==========================================================
  gravity_blade: {
    id: 'gravity_blade',
    name: 'GRAVITY BLADE',
    glyph: '🗡️',
    color: '#9933ff',
    skills: [
      {
        id: 'superforce_lightning',
        name: 'SUPERFORCE LIGHTNING',
        key: 'Z',
        range: 'INSTANT-KILL / 50% HP',
        baseCd: 3.0,
        desc: 'Sword glows 1s before striking ultra lightning with % chance to instant kill normal enemies (50% max HP on elite/boss). Max charge has 42% chance for 20x damage.',
        cast: (ctx) => {
          // Glow sword
          ctx.sound.playLaser(0.6);

          setTimeout(() => {
            const target = ctx.player.aimTarget.clone();
            // ONE-PIECE CINEMATIC: purple gravity-beam lancing from the blade
            const from = ctx.player.position.clone();
            from.y = 1.8;
            ctx.explosions.beam(from, target.clone().add(new THREE.Vector3(0, 1.2, 0)), 2.4, 0xcc44ff);
            ctx.lightning.strikeOverlapped(target, 6, 4.0, 110, '#cc44ff');
            ctx.explosions.createExplosion(target, 16.0, 'lightning', 2.8);

            const enemies = ctx.enemies.getEnemiesInRadius(target, 16.0);
            for (const e of enemies) {
              // Blinded for 10s
              e.applyStatus('blind', 10.0);

              if (e.type === 'elite' || e.type === 'boss') {
                e.takeDamage(e.maxHp * 0.5, true, 'sword');
              } else {
                // Instant kill chance based on sword charge
                const isMax = ctx.player.gravityBladeCharge >= 100;
                if (isMax && Math.random() < 0.42) {
                  e.takeDamage(e.maxHp * 20.0, true, 'sword');
                } else {
                  e.takeDamage(e.maxHp, true, 'sword'); // Instant kill normal enemy
                }
              }
            }

            // Consume charge
            ctx.player.gravityBladeCharge = Math.max(0, ctx.player.gravityBladeCharge - 10);
          }, 1000);
        }
      },
      {
        id: 'rainy_meteors',
        name: 'RAINY METEORS',
        key: 'X',
        range: '80 METEORS (130M/S)',
        baseCd: 5.0,
        desc: 'Rains 80 small meteors down (speed 130m/s, interval 0.06s, explosion radius 12m).',
        cast: (ctx) => {
          let count = 0;
          const meteorTimer = setInterval(() => {
            count++;
            if (count > 80) {
              clearInterval(meteorTimer);
              return;
            }
            const hitPos = ctx.player.position.clone().add(new THREE.Vector3(
              (Math.random() - 0.5) * 80,
              0,
              (Math.random() - 0.5) * 80
            ));
            ctx.explosions.createExplosion(hitPos, 12.0, 'asteroid', 1.2);

            const hitEnemies = ctx.enemies.getEnemiesInRadius(hitPos, 12.0);
            for (const e of hitEnemies) {
              e.takeDamage(380, false, 'sword');
            }
          }, 60);
        }
      },
      {
        id: 'rocks_extinction',
        name: 'ROCKS EXTINCTION',
        key: 'C',
        range: '26 BOULDERS (24M AOE)',
        baseCd: 7.0,
        desc: 'Surface spawns 26 rocks upward in square AoE for 1.2s then slams down at random enemies one by one (0.15s interval, 24m explosion). Follows player.',
        cast: (ctx) => {
          let rocksLeft = 26;
          const rockInterval = setInterval(() => {
            rocksLeft--;
            if (rocksLeft <= 0) {
              clearInterval(rockInterval);
              return;
            }
            const enemies = ctx.enemies.enemies;
            const target = enemies.length > 0 ? enemies[Math.floor(Math.random() * enemies.length)].mesh.position : ctx.player.position;
            const strikePos = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 15, 0, (Math.random() - 0.5) * 15));

            ctx.explosions.createExplosion(strikePos, 24.0, 'quake', 2.4);
            const hitEnemies = ctx.enemies.getEnemiesInRadius(strikePos, 24.0);
            for (const e of hitEnemies) {
              e.takeDamage(750, false, 'sword');
            }
          }, 150);
        }
      },
      {
        id: 'death_slashes',
        name: 'DEATH SLASHES',
        key: 'V',
        range: '23 AUTO-AIM SLASHES',
        baseCd: 3.0,
        desc: 'Unleashes 23 diagonal curved slashes auto-aiming at enemies, interval 0.15s. Stuns, lightning, 27% burn for 10s. 22% chance for 2500% bigger explosion.',
        cast: (ctx) => {
          let slashCount = 0;
          const slashTimer = setInterval(() => {
            slashCount++;
            if (slashCount > 23) {
              clearInterval(slashTimer);
              return;
            }
            const enemies = ctx.enemies.enemies;
            const target = enemies.length > 0 ? enemies[slashCount % enemies.length] : null;
            const hitPos = target ? target.mesh.position.clone() : ctx.player.position.clone().add(new THREE.Vector3(0, 0, -20));

            const isMega = Math.random() < 0.22;
            const radius = isMega ? 25.0 : 6.0;
            const shake = isMega ? 3.5 : 1.2;
            const dmg = isMega ? 8500 : 850;

            ctx.lightning.strikeBolt(hitPos, 60, '#cc44ff', 0.2, 16);
            ctx.explosions.createExplosion(hitPos, radius, 'asteroid', shake);

            if (target && !target.dead) {
              target.takeDamage(dmg, true, 'sword');
              target.applyStatus('stun', 1.5);
              target.applyStatus('burn', 10.0);
            }
          }, 150);
        }
      },
      {
        id: 'super_slashes',
        name: 'SUPER SLASHES',
        key: 'B',
        range: '50M RADIUS STORM',
        baseCd: 4.0,
        desc: 'Storm of rapidly large slashing sword at 0.01s interval in 50m radius for 3s. Slashes follow player, stacks bleed 1% for 5s.',
        cast: (ctx) => {
          let timer = 0;
          const stormInterval = setInterval(() => {
            timer += 0.03;
            if (timer >= 3.0) {
              clearInterval(stormInterval);
              return;
            }
            // Slashes follow player position
            const hitEnemies = ctx.enemies.getEnemiesInRadius(ctx.player.position, 50.0);
            for (const e of hitEnemies) {
              e.takeDamage(120, false, 'sword');
              e.applyStatus('bleed', 5.0);
            }
            ctx.cameraController.addShake(ctx.player.position, 0.4, 0.05);
          }, 30);
        }
      }
    ]
  },

  // ==========================================================
  // 3. LIGHTNING FRUIT (6 Skills)
  // ==========================================================
  lightning: {
    id: 'lightning',
    name: 'LIGHTNING FRUIT',
    glyph: '⚡',
    color: '#00f0ff',
    skills: [
      {
        id: 'bestia_relampago',
        name: 'BESTIA RELÁMPAGO',
        key: 'Z',
        range: '30M AOE (30M/S)',
        baseCd: 5.0,
        desc: 'Shoots a beast of lightning that explodes upon hitting. Can be auto-aimed. (Explosion radius: 30m, speed: 30m/s).',
        cast: (ctx) => {
          const closest = ctx.enemies.findClosestEnemy(ctx.player.position, 120);
          const targetPos = closest.enemy ? closest.enemy.mesh.position.clone() : ctx.player.aimTarget.clone();
          targetPos.y = 0;

          ctx.sound.playLightning(1.0, 1.2);

          // Projectile travel simulation
          const startPos = ctx.player.position.clone();
          startPos.y += 1.5;
          const beastGeo = new THREE.SphereGeometry(3.0, 12, 12);
          const beastMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, wireframe: true });
          const beast = new THREE.Mesh(beastGeo, beastMat);
          beast.position.copy(startPos);
          ctx.scene.add(beast);

          let elapsed = 0;
          const totalTime = startPos.distanceTo(targetPos) / 30.0;
          const intervalId = setInterval(() => {
            elapsed += 0.03;
            const t = elapsed / Math.max(0.2, totalTime);
            if (t >= 1.0) {
              clearInterval(intervalId);
              ctx.scene.remove(beast);
              beastMat.dispose();

              ctx.lightning.strikeOverlapped(targetPos, 6, 6.0, 100, '#00f0ff');
              ctx.explosions.createExplosion(targetPos, 30.0, 'lightning', 2.5);

              const enemies = ctx.enemies.getEnemiesInRadius(targetPos, 30.0);
              for (const e of enemies) {
                e.takeDamage(1600, false, 'fruit');
                e.applyStatus('stun', 1.5);
              }
            } else {
              beast.position.lerpVectors(startPos, targetPos, t);
            }
          }, 30);
        }
      },
      {
        id: 'tormenta',
        name: 'TORMENTA',
        key: 'X',
        range: '17 BOLTS (4.5M AOE)',
        baseCd: 8.0,
        desc: 'Strikes a shower of 17 overlapped lightning bolts in random area (interval 0.22s, explosion radius 4.5m).',
        cast: (ctx) => {
          let count = 0;
          const center = ctx.player.aimTarget.clone();
          center.y = 0;

          const stormTimer = setInterval(() => {
            count++;
            if (count > 17) {
              clearInterval(stormTimer);
              return;
            }
            const hitPos = center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 35, 0, (Math.random() - 0.5) * 35));
            ctx.lightning.strikeOverlapped(hitPos, 3, 2.0, 90, '#00f0ff');
            ctx.explosions.createExplosion(hitPos, 4.5, 'lightning', 1.0);

            const hitEnemies = ctx.enemies.getEnemiesInRadius(hitPos, 4.5);
            for (const e of hitEnemies) {
              e.takeDamage(550, false, 'fruit');
            }
          }, 220);
        }
      },
      {
        id: 'juicio_celestial',
        name: 'JUICIO CELESTIAL',
        key: 'C',
        range: '7M RADIUS (3S STUN)',
        baseCd: 12.0,
        desc: 'Strikes numerous overlapping lightning bolts in one spot. Enemies hit are lifted up and stunned for 3 seconds.',
        cast: (ctx) => {
          const target = ctx.player.aimTarget.clone();
          target.y = 0;

          ctx.lightning.strikeOverlapped(target, 12, 3.0, 120, '#00ffff');
          ctx.explosions.createExplosion(target, 7.0, 'lightning', 2.2);

          const enemies = ctx.enemies.getEnemiesInRadius(target, 7.0);
          for (const e of enemies) {
            e.applyStatus('stun', 3.0);
            e.applyKnockback(new THREE.Vector3(0, 1, 0), 20.0); // Lift up into air
            e.takeDamage(1400, true, 'fruit');
          }
        }
      },
      {
        id: 'destruccion_bola_trueno',
        name: 'DESTRUCCIÓN BOLA',
        key: 'V',
        range: 'EXPANDING 15M/S (5S)',
        baseCd: 20.0,
        desc: 'Spawns a big black ball crashing down at mouse position at 50m/s. Explodes and continuously expands at 15m/s for 5 seconds.',
        cast: (ctx) => {
          const target = ctx.player.aimTarget.clone();
          target.y = 0;

          const ballGeo = new THREE.SphereGeometry(6.0, 24, 24);
          const ballMat = new THREE.MeshStandardMaterial({
            color: 0x050510,
            roughness: 0.2,
            metalness: 0.9,
            emissive: 0x003366
          });
          const ballMesh = new THREE.Mesh(ballGeo, ballMat);
          ballMesh.position.set(target.x, 90, target.z);
          ctx.scene.add(ballMesh);

          // Crash down at 50 m/s
          let elapsed = 0;
          const totalTime = 90 / 50.0;
          const crashTimer = setInterval(() => {
            elapsed += 0.03;
            if (elapsed >= totalTime) {
              clearInterval(crashTimer);
              ctx.scene.remove(ballMesh);
              ballMat.dispose();

              // Big initial explosion
              ctx.explosions.createExplosion(target, 25.0, 'lightning', 3.5);

              // ONE-PIECE CINEMATIC: black-hole suction vortex + shockwave
              ctx.explosions.vortex(target, 0x33aaff, 22.0, 5.0);
              ctx.explosions.megaShockwave(target, 70.0, 0x00d4ff);

              // Expanding continuous explosion at 15 m/s for 5 seconds
              let expandTime = 0;
              const expandTimer = setInterval(() => {
                expandTime += 0.25;
                if (expandTime >= 5.0) {
                  clearInterval(expandTimer);
                  return;
                }
                const currentRadius = 25.0 + expandTime * 15.0;
                ctx.explosions.createExplosion(target, currentRadius, 'lightning', 1.5);

                const hitEnemies = ctx.enemies.getEnemiesInRadius(target, currentRadius);
                for (const e of hitEnemies) {
                  e.takeDamage(600 * 0.25, false, 'fruit');
                }
              }, 250);
            } else {
              ballMesh.position.y = 90 - elapsed * 50.0;
            }
          }, 30);
        }
      },
      {
        id: 'destello_electrico',
        name: 'DESTELLO ELÉCTRICO',
        key: 'B',
        range: '10M DASH (240M/S)',
        baseCd: 1.0,
        desc: 'Lightning dash forward 10m at 240 m/s. Deals damage on collision. Consumes 1 charge (max 3, +1 per 3s).',
        cast: (ctx) => {
          if (ctx.player.lightningDashCharges <= 0) return;
          ctx.player.lightningDashCharges--;

          // Forward direction
          const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), ctx.player.group.rotation.y);
          ctx.player.triggerDash(10.0, 240.0);

          // Strike lightning at start and end
          ctx.lightning.strikeBolt(ctx.player.position, 60, '#00f0ff', 0.2, 16);

          const hitEnemies = ctx.enemies.getEnemiesInRadius(ctx.player.position, 6.0);
          for (const e of hitEnemies) {
            e.takeDamage(850, false, 'fruit');
            e.applyStatus('stun', 0.8);
          }
        }
      },
      {
        id: 'mas_alla_del_trueno',
        name: 'MÁS ALLÁ DEL TRUENO',
        key: 'F',
        range: '120 THUNDERCLOUDS',
        baseCd: 30.0,
        desc: 'Spawns 120 thunderclouds that strike overlapped lightning bolts in random area (interval 0.1s, explosion radius 16m, stun 3s).',
        cast: (ctx) => {
          let strikesDone = 0;
          const maxStrikes = 120;

          const stormTimer = setInterval(() => {
            strikesDone++;
            if (strikesDone >= maxStrikes) {
              clearInterval(stormTimer);
              return;
            }

            const hitPos = ctx.player.position.clone().add(new THREE.Vector3(
              (Math.random() - 0.5) * 140,
              0,
              (Math.random() - 0.5) * 140
            ));

            ctx.lightning.strikeOverlapped(hitPos, 2, 3.0, 100, '#00ffff');
            ctx.explosions.createExplosion(hitPos, 16.0, 'lightning', 1.4);

            const hitEnemies = ctx.enemies.getEnemiesInRadius(hitPos, 16.0);
            for (const e of hitEnemies) {
              e.takeDamage(750, false, 'fruit');
              e.applyStatus('stun', 3.0);
            }
          }, 100);
        }
      }
    ]
  },

  // ==========================================================
  // 4. POLE (Weapon - 2 Skills + M1)
  // ==========================================================
  pole: {
    id: 'pole',
    name: 'POLE (STAFF)',
    glyph: '🥢',
    color: '#ffcc00',
    skills: [
      {
        id: 'asalto_atronador',
        name: 'ASALTO ATRONADOR',
        key: 'Z',
        range: 'FORWARD CLOUD (2M)',
        baseCd: 3.0,
        desc: 'Shoots a cloud forward that explodes after 1s (explosion radius 2m).',
        cast: (ctx) => {
          const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), ctx.player.group.rotation.y);
          const targetPos = ctx.player.position.clone().addScaledVector(forward, 18.0);

          setTimeout(() => {
            ctx.lightning.strikeBolt(targetPos, 50, '#ffea00', 0.25, 16);
            ctx.explosions.createExplosion(targetPos, 2.0, 'lightning', 1.0);
            const enemies = ctx.enemies.getEnemiesInRadius(targetPos, 3.5);
            for (const e of enemies) {
              e.takeDamage(600, false, 'sword');
            }
          }, 1000);
        }
      },
      {
        id: 'juicio_continuo',
        name: 'JUICIO CONTINUO',
        key: 'X',
        range: 'CONTINUOUS SUCK & STRIKE',
        baseCd: 10.0,
        desc: 'Strikes continuous overlapping lightning at cursor. Costs 1% HP per tick, increases radius +5%/s up to +50%, sucks enemies within 9m. Casts while HP > 50%.',
        cast: (ctx) => {
          let bonusRadius = 0;
          let ticks = 0;

          const channelTimer = setInterval(() => {
            ticks++;
            // Check player HP > 50%
            if (ctx.player.hp <= ctx.player.maxHp * 0.5 || ticks > 40) {
              clearInterval(channelTimer);
              return;
            }

            // Cost 1% HP
            ctx.player.hp -= ctx.player.maxHp * 0.01;

            // Increase radius by 5% per second (0.5% per 0.1s tick) up to +50%
            bonusRadius = Math.min(4.0, bonusRadius + 0.05);

            const hitPos = ctx.player.aimTarget.clone();
            hitPos.y = 0;

            const currentRadius = 8.0 + bonusRadius;
            ctx.lightning.strikeOverlapped(hitPos, 3, 2.0, 90, '#ffea00');
            ctx.explosions.createExplosion(hitPos, currentRadius, 'lightning', 1.1);

            // Suction within 9m
            const suckEnemies = ctx.enemies.getEnemiesInRadius(hitPos, 9.0);
            for (const e of suckEnemies) {
              const pullDir = new THREE.Vector3().subVectors(hitPos, e.mesh.position).normalize();
              e.applyKnockback(pullDir, 12.0);
              e.takeDamage(320, false, 'sword');
            }
          }, 100);
        }
      }
    ]
  },

  // ==========================================================
  // 5. QUAKE FRUIT (4 Skills - Neon blue cracks reused from lightning)
  // ==========================================================
  quake: {
    id: 'quake',
    name: 'QUAKE FRUIT',
    glyph: '🌋',
    color: '#00bfff',
    skills: [
      {
        id: 'fatal_destruction',
        name: 'FATAL DESTRUCTION',
        key: 'Z',
        range: 'GRAB PUNCH (RED SCREEN)',
        baseCd: 5.0,
        desc: 'Pulls enemy. Screen pauses and turns red, then deeper red for 1s until punch out strong quake punch with knockback.',
        cast: (ctx) => {
          const closest = ctx.enemies.findClosestEnemy(ctx.player.position, 12.0);
          if (!closest.enemy) return; // If caught enemy trigger, if not nothing!

          // Pause screen & shift to red
          ctx.triggerScreenFlash('#ff0033', 1.0);

          setTimeout(() => {
            ctx.explosions.createExplosion(closest.enemy.mesh.position, 15.0, 'quake', 3.4);
            closest.enemy.takeDamage(2400, true, 'fruit');
            const knockDir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), ctx.player.group.rotation.y);
            closest.enemy.applyKnockback(knockDir, 45.0);
          }, 1000);
        }
      },
      {
        id: 'air_crusher',
        name: 'AIR CRUSHER',
        key: 'X',
        range: 'QUAKE ORB (2S STUN)',
        baseCd: 7.0,
        desc: 'Shoots a large forward quake orb that stuns enemies for 2s. Neon blue cracks appear at hand on cast.',
        cast: (ctx) => {
          // Neon blue crack at hand
          ctx.lightning.strikeCrack(ctx.player.position.clone().add(new THREE.Vector3(0, 1.5, 0)), ctx.player.position.clone().add(new THREE.Vector3(1, 1.5, 1)), '#00bfff', 0.4);

          const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), ctx.player.group.rotation.y);
          const orbTarget = ctx.player.position.clone().addScaledVector(forward, 25.0);

          ctx.explosions.createExplosion(orbTarget, 16.0, 'quake', 2.0);
          const enemies = ctx.enemies.getEnemiesInRadius(orbTarget, 16.0);
          for (const e of enemies) {
            e.takeDamage(1200, false, 'fruit');
            e.applyStatus('stun', 2.0);
          }
        }
      },
      {
        id: 'spatial_shockwave',
        name: 'SPATIAL SHOCKWAVE',
        key: 'C',
        range: 'SMASH (5S STUN / 10M KNOCK)',
        baseCd: 7.0,
        desc: 'Smash ground. Huge shockwave with neon blue cracks on ground, white semi-transparent shockwave, debris blocks, cracks on arms. Stuns 5s, knocks back 10m.',
        cast: (ctx) => {
          const smashPos = ctx.player.position.clone();
          smashPos.y = 0;

          // Ground neon blue cracks
          for (let i = 0; i < 6; i++) {
            const crackEnd = smashPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30));
            ctx.lightning.strikeCrack(smashPos, crackEnd, '#00bfff', 0.6);
          }

          ctx.explosions.createExplosion(smashPos, 28.0, 'quake', 3.5);

          // ONE-PIECE CINEMATIC: colossal triple shockwave racing outward
          ctx.explosions.megaShockwave(smashPos, 60.0, 0x00bfff);

          const enemies = ctx.enemies.getEnemiesInRadius(smashPos, 28.0);
          for (const e of enemies) {
            e.takeDamage(1800, true, 'fruit');
            e.applyStatus('stun', 5.0);
            const knockDir = new THREE.Vector3().subVectors(e.mesh.position, smashPos).normalize();
            e.applyKnockback(knockDir, 10.0);
          }
        }
      },
      {
        id: 'seaquake',
        name: 'SEAQUAKE',
        key: 'V',
        range: '16 + 4 MEGA TSUNAMIS',
        baseCd: 14.5,
        desc: 'Smash ground expanding 3 times rapidly with quake cracks along floor. Spawns 16 tsunamis from all 4 sides (6 large, 10 small) passing through player, plus 4 colossal tsunamis (8x bigger, 3x dmg).',
        cast: (ctx) => {
          const p = ctx.player.position.clone();
          p.y = 0;

          // 3 rapid expanding cracks
          let count = 0;
          const crackTimer = setInterval(() => {
            count++;
            if (count > 3) {
              clearInterval(crackTimer);
              return;
            }
            const r = count * 20.0;
            ctx.explosions.createExplosion(p, r, 'quake', 2.0);
          }, 200);

          // ONE-PIECE CINEMATIC: giant shockwave rings as the tsunamis erupt
          ctx.explosions.megaShockwave(p, 110.0, 0x66ccff);

          // Spawn 16 tsunamis (6 large, 10 small) from 4 directions
          const dirs = [
            new THREE.Vector3(1, 0, 0),
            new THREE.Vector3(-1, 0, 0),
            new THREE.Vector3(0, 0, 1),
            new THREE.Vector3(0, 0, -1)
          ];

          for (let i = 0; i < 16; i++) {
            const dir = dirs[i % 4];
            const isLarge = i < 6;
            const spawnPos = p.clone().addScaledVector(dir, -90.0).add(new THREE.Vector3((Math.random() - 0.5) * 60, 0, (Math.random() - 0.5) * 60));
            ctx.weather.spawnTsunami(spawnPos, dir, isLarge ? 50 : 25, isLarge ? 14 : 7, 35, isLarge);
          }

          // 4 Colossal tsunamis (8x bigger, 3x damage)
          setTimeout(() => {
            for (let j = 0; j < 4; j++) {
              const dir = dirs[j];
              const megaPos = p.clone().addScaledVector(dir, -130.0);
              ctx.weather.spawnTsunami(megaPos, dir, 120, 28, 40, true);
            }
          }, 800);
        }
      }
    ]
  },

  // ==========================================================
  // 6. BISENTO (Weapon - 3 Skills)
  // ==========================================================
  bisento: {
    id: 'bisento',
    name: 'BISENTO (HALBERD)',
    glyph: '⚔️',
    color: '#3399ff',
    skills: [
      {
        id: 'quake_slam',
        name: 'QUAKE SLAM',
        key: 'Z',
        range: 'SHOCKWAVE (2.5S STUN)',
        baseCd: 2.0,
        desc: 'Slam sword on ground with huge shockwave, cracks on AoE, white semi-transparent expanding shockwave. Stuns 2.5s, knocks back afar.',
        cast: (ctx) => {
          const p = ctx.player.position.clone();
          p.y = 0;
          ctx.explosions.createExplosion(p, 18.0, 'quake', 2.2);

          const enemies = ctx.enemies.getEnemiesInRadius(p, 18.0);
          for (const e of enemies) {
            e.takeDamage(950, false, 'sword');
            e.applyStatus('stun', 2.5);
            const knockDir = new THREE.Vector3().subVectors(e.mesh.position, p).normalize();
            e.applyKnockback(knockDir, 28.0);
          }
        }
      },
      {
        id: 'quake_ball',
        name: 'QUAKE BALL',
        key: 'X',
        range: '5 DIAGONAL ORBS',
        baseCd: 3.0,
        desc: 'Shoots out 5 diagonal small quake orbs that explode once they hit something.',
        cast: (ctx) => {
          const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), ctx.player.group.rotation.y);
          for (let i = -2; i <= 2; i++) {
            const spreadAngle = i * 0.18;
            const dir = forward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), spreadAngle);
            const hitPos = ctx.player.position.clone().addScaledVector(dir, 24.0);

            ctx.explosions.createExplosion(hitPos, 6.0, 'quake', 1.0);
            const enemies = ctx.enemies.getEnemiesInRadius(hitPos, 6.0);
            for (const e of enemies) {
              e.takeDamage(550, false, 'sword');
            }
          }
        }
      },
      {
        id: 'mini_seaquake',
        name: 'MINI SEAQUAKE',
        key: 'C',
        range: '23 SMALL TSUNAMIS',
        baseCd: 5.0,
        desc: 'Slam ground: 23 small tsunamis appear from random directions moving toward player and passing through.',
        cast: (ctx) => {
          const p = ctx.player.position.clone();
          for (let i = 0; i < 23; i++) {
            const angle = (i / 23) * Math.PI * 2;
            const origin = p.clone().add(new THREE.Vector3(Math.cos(angle) * 70, 0, Math.sin(angle) * 70));
            const dir = new THREE.Vector3().subVectors(p, origin).normalize();
            ctx.weather.spawnTsunami(origin, dir, 18, 5, 32, false);
          }
        }
      }
    ]
  },

  // ==========================================================
  // 7. ALARM FRUIT & ALARM SWORD
  // ==========================================================
  alarm: {
    id: 'alarm',
    name: 'ALARM FRUIT',
    glyph: '🚨',
    color: '#ff0044',
    skills: [
      {
        id: 'manual_alert',
        name: 'MANUAL ALERT',
        key: 'Z',
        range: '80M RADIUS IMPRISON',
        baseCd: 3.0,
        desc: 'Shoots red laser beams that imprison enemies for 6s at 80m detection radius.',
        cast: (ctx) => {
          ctx.sound.playLaser(1.2);
          const enemies = ctx.enemies.getEnemiesInRadius(ctx.player.position, 80.0);
          for (const e of enemies) {
            e.applyStatus('imprison', 6.0);
            e.takeDamage(750, false, 'fruit');
          }
        }
      },
      {
        id: 'automatic_transmission',
        name: 'AUTO TRANSMISSION',
        key: 'X',
        range: 'HIGHEST HP ENEMY',
        baseCd: 5.5,
        desc: 'Fires large red laser beam at highest HP enemy that imprisons for 15s and strikes a tall red beam down near it.',
        cast: (ctx) => {
          const highest = ctx.enemies.findHighestHpEnemy(ctx.player.position, 300);
          if (!highest) return;

          ctx.sound.playLaser(0.8);
          highest.applyStatus('imprison', 15.0);
          highest.takeDamage(2200, true, 'fruit');

          // Tall red beam down
          ctx.lightning.strikeBolt(highest.mesh.position, 120, '#ff0044', 0.6, 24);
          ctx.explosions.createExplosion(highest.mesh.position, 14.0, 'alarm', 2.0);
        }
      },
      {
        id: 'siren_blaster',
        name: 'SIREN BLASTER',
        key: 'C',
        range: '1000M SIREN BLARING',
        baseCd: 8.0,
        desc: 'Blasts loud blaring siren alarm. Enemies within 1000m move away, struck by red beam with lightning aura every 1s for 7s.',
        cast: (ctx) => {
          ctx.sound.playSiren(700, 1.2);

          let ticks = 0;
          const sirenTimer = setInterval(() => {
            ticks++;
            if (ticks > 7) {
              clearInterval(sirenTimer);
              return;
            }

            ctx.sound.playSiren(600 + ticks * 40, 0.3);
            const enemies = ctx.enemies.enemies;
            for (const e of enemies) {
              // Move away from player
              const awayDir = new THREE.Vector3().subVectors(e.mesh.position, ctx.player.position).normalize();
              e.applyKnockback(awayDir, 16.0);
              e.takeDamage(350, false, 'fruit');
              ctx.lightning.strikeBolt(e.mesh.position, 60, '#ff0044', 0.2, 16);
              // ONE-PIECE CINEMATIC: crimson siren beam from operative to target
              const from = ctx.player.position.clone();
              from.y = 1.6;
              ctx.explosions.beam(from, e.mesh.position.clone().add(new THREE.Vector3(0, 1.4, 0)), 0.7, 0xff0044);
            }
          }, 1000);
        }
      },
      {
        id: 'alarm_buffer',
        name: 'ALARM BUFFER',
        key: 'V',
        range: 'BUFF (+200% DMG, -25% CD)',
        baseCd: 15.0,
        desc: 'Gains +200% damage, +200% AoE, and -25% cooldown for 30s. Hits strike reddish lightning dealing 20% max health.',
        cast: (ctx) => {
          ctx.player.buffs.alarmBuffer.active = true;
          ctx.player.buffs.alarmBuffer.timer = 30.0;
          ctx.sound.playUiBeep(1200);
        }
      },
      {
        id: 'amber_alert',
        name: 'AMBER ALERT',
        key: 'B',
        range: '15 GIANT ATTACKERS',
        baseCd: 30.0,
        desc: 'Spawns 15 giant attackers with alarm swords (range 200m, move 20m/s, despawn 15s). Spawns mini hacker every 2s hacking enemies to heal player!',
        cast: (ctx) => {
          ctx.sound.playSiren(500, 2.0);

          // Spawn 15 attacker phantom meshes
          for (let i = 0; i < 15; i++) {
            const angle = (i / 15) * Math.PI * 2;
            const p = ctx.player.position.clone().add(new THREE.Vector3(Math.cos(angle) * 15, 0, Math.sin(angle) * 15));
            ctx.explosions.createExplosion(p, 10.0, 'alarm', 1.0);
          }

          // Mini hacker hacks enemies every 2s for 15s
          let hackTicks = 0;
          const hackTimer = setInterval(() => {
            hackTicks++;
            if (hackTicks > 7) {
              clearInterval(hackTimer);
              return;
            }
            const enemies = ctx.enemies.enemies;
            for (const e of enemies) {
              e.applyStatus('hack', 5.0);
            }
          }, 2000);
        }
      }
    ]
  },

  // ==========================================================
  // ALARM SWORD (Weapon)
  // ==========================================================
  alarm_sword: {
    id: 'alarm_sword',
    name: 'ALARM SWORD',
    glyph: '🗡️',
    color: '#ff2a55',
    skills: [
      {
        id: 'red_stomp',
        name: 'RED STOMP',
        key: 'Z',
        range: '40M RADIUS (50M FLY)',
        baseCd: 5.0,
        desc: 'Giant stomps the ground knocking enemies flying up to 50m. Explosion radius: 40m, camera shake intensity: 13.',
        cast: (ctx) => {
          const p = ctx.player.position.clone();
          p.y = 0;

          // Camera shake intensity 13!
          ctx.cameraController.addShake(p, 13.0, 1.2);
          ctx.explosions.createExplosion(p, 40.0, 'alarm', 13.0);

          const enemies = ctx.enemies.getEnemiesInRadius(p, 40.0);
          for (const e of enemies) {
            e.takeDamage(2200, true, 'sword');
            e.applyKnockback(new THREE.Vector3(0, 1, 0), 50.0); // Fly up 50 meters
          }
        }
      }
    ]
  },

  // ==========================================================
  // 8. RIMEFRACTURE FRUIT (Ice Gun Passive + 3 Skills)
  // ==========================================================
  rimefracture: {
    id: 'rimefracture',
    name: 'RIMEFRACTURE FRUIT',
    glyph: '❄️',
    color: '#88eeff',
    skills: [
      {
        id: 'icy_power',
        name: 'ICY POWER',
        key: 'Z',
        range: '18 ICICLES (45M AOE)',
        baseCd: 3.5,
        desc: 'Shoots down 18 giant icicles at 20m radius in random area (interval 0.13s). Explodes into 20-40 fragments at 45m radius dealing 50% dmg.',
        cast: (ctx) => {
          let drops = 0;
          const dropTimer = setInterval(() => {
            drops++;
            if (drops > 18) {
              clearInterval(dropTimer);
              return;
            }
            const hitPos = ctx.player.position.clone().add(new THREE.Vector3(
              (Math.random() - 0.5) * 40,
              0,
              (Math.random() - 0.5) * 40
            ));
            ctx.explosions.createExplosion(hitPos, 45.0, 'ice', 1.8);

            const hitEnemies = ctx.enemies.getEnemiesInRadius(hitPos, 45.0);
            for (const e of hitEnemies) {
              e.takeDamage(650, false, 'fruit');
              e.applyStatus('freeze', 3.0);
            }
          }, 130);
        }
      },
      {
        id: 'ice_bombard',
        name: 'ICE BOMBARD',
        key: 'X',
        range: 'SUPERPOWER (+7.8M% DMG)',
        baseCd: 30.0,
        desc: 'Activates superpower state for 15s. Gun damage raised by +7,800,000% and fire CD reduced by 77%. Skills freeze enemies for 3s.',
        cast: (ctx) => {
          ctx.player.buffs.iceBombard.active = true;
          ctx.player.buffs.iceBombard.timer = 15.0;
          ctx.sound.playFreezeShatter();
        }
      },
      {
        id: 'snowy_destruction',
        name: 'SNOWY DESTRUCTION',
        key: 'C',
        range: '5000M BLIZZARD STOMP',
        baseCd: 8.0,
        desc: 'Supersonic foot stomp. 5000m explosion, leaves huge debris, screen flashes icy blue for 0.5s, freezes enemies for 10s. Camera shake intensity: 60, duration: 12s.',
        cast: (ctx) => {
          // Warm up 0.5s with invincibility
          ctx.player.buffs.invincible.active = true;
          ctx.player.buffs.invincible.timer = 0.5;

          setTimeout(() => {
            // Screen flash icy blue for 0.5s
            ctx.triggerScreenFlash('#00f0ff', 0.5);

            // Huge camera shake (intensity 60, duration 12s)
            ctx.cameraController.addShake(ctx.player.position, 60.0, 12.0);

            // 5000m arena-wide explosion
            ctx.explosions.createExplosion(ctx.player.position, 120.0, 'ice', 6.0);

            // ONE-PIECE CINEMATIC: blizzard shockwave racing across the arena
            ctx.explosions.megaShockwave(ctx.player.position, 160.0, 0x9ff4ff);
            ctx.explosions.vortex(ctx.player.position, 0xbfefff, 20.0, 4.0);

            // Freeze all enemies for 10 seconds & continuous damage
            const enemies = ctx.enemies.enemies;
            for (const e of enemies) {
              e.applyStatus('freeze', 10.0);
              e.takeDamage(4500, true, 'fruit');
            }
          }, 500);
        }
      }
    ]
  },

  // ==========================================================
  // 9. WILDFIRE FRUIT (Fire Gun Passive + 3 Skills)
  // ==========================================================
  wildfire: {
    id: 'wildfire',
    name: 'WILDFIRE FRUIT',
    glyph: '🔥',
    color: '#ff5500',
    skills: [
      {
        id: 'firestorm',
        name: 'FIRESTORM',
        key: 'Z',
        range: '150 FIREBALLS (30M AOE)',
        baseCd: 5.0,
        desc: 'Fires a spray of 150 fireballs in 30° spread angle (interval 0.035s). Explodes in 30m radius, leaves burn pit for 6s.',
        cast: (ctx) => {
          let count = 0;
          const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), ctx.player.group.rotation.y);

          const sprayTimer = setInterval(() => {
            count++;
            if (count > 150) {
              clearInterval(sprayTimer);
              return;
            }
            const angleOffset = (Math.random() - 0.5) * (Math.PI / 6); // 30 degrees spread
            const dir = forward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angleOffset);
            const hitPos = ctx.player.position.clone().addScaledVector(dir, 15.0 + Math.random() * 25.0);

            ctx.explosions.createExplosion(hitPos, 30.0, 'fire', 1.2);
            const hitEnemies = ctx.enemies.getEnemiesInRadius(hitPos, 30.0);
            for (const e of hitEnemies) {
              e.takeDamage(120, false, 'fruit');
              e.applyStatus('burn', 3.0);
            }
            ctx.spawnFirepit(hitPos, 10.0, 6.0, 0.02);
          }, 35);
        }
      },
      {
        id: 'hell_fury',
        name: 'HELL FURY',
        key: 'X',
        range: 'SUPERPOWER (+1.25M% DMG)',
        baseCd: 30.0,
        desc: 'Superpower state for 10s. Gun damage +1,250,000%, gun CD -78%. Every skill hit triggers burn for 3s.',
        cast: (ctx) => {
          ctx.player.buffs.hellFury.active = true;
          ctx.player.buffs.hellFury.timer = 10.0;
          ctx.sound.playExplosion(0.8);
          // ONE-PIECE CINEMATIC: hellfire shockwave erupting from the operative
          ctx.explosions.megaShockwave(ctx.player.position, 80.0, 0xff4400);
          ctx.explosions.vortex(ctx.player.position, 0xff7722, 12.0, 6.0);
        }
      },
      {
        id: 'burning_lightning',
        name: 'BURNING LIGHTNING',
        key: 'C',
        range: '40 LAVA ROCKS + ORANGE LIGHTNING',
        baseCd: 5.0,
        desc: 'Spray of 40 giant lava rocks in 40° spread (interval 0.1s). Explodes 50m radius, leaves lava pit 10s. Hits trigger tall orange lightning bolts.',
        cast: (ctx) => {
          let count = 0;
          const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), ctx.player.group.rotation.y);

          const lavaTimer = setInterval(() => {
            count++;
            if (count > 40) {
              clearInterval(lavaTimer);
              return;
            }
            const angle = (Math.random() - 0.5) * (Math.PI * 40 / 180);
            const dir = forward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
            const hitPos = ctx.player.position.clone().addScaledVector(dir, 20.0 + Math.random() * 30.0);

            ctx.explosions.createExplosion(hitPos, 50.0, 'fire', 2.2);
            ctx.lightning.strikeBolt(hitPos, 90, '#ff6600', 0.3, 24);

            const hitEnemies = ctx.enemies.getEnemiesInRadius(hitPos, 50.0);
            for (const e of hitEnemies) {
              e.takeDamage(620, false, 'fruit');
              e.applyStatus('burn', 3.0);
            }
            ctx.spawnFirepit(hitPos, 16.0, 10.0, 0.04);
          }, 100);
        }
      }
    ]
  },

  // ==========================================================
  // 10. CLOUD FRUIT (10 Skills + M1)
  // ==========================================================
  cloud: {
    id: 'cloud',
    name: 'CLOUD FRUIT',
    glyph: '☁️',
    color: '#ffffff',
    skills: [
      {
        id: 'cumulus_growth',
        name: 'CUMULUS GROWTH',
        key: 'Z',
        range: 'DYNAMIC GROWTH (2 MIN)',
        baseCd: 5.0,
        desc: 'Spawns cloud taking 10s to grow from humilis to cumulonimbus. 35% chance to evolve into supercell. Rain, hail & superbolt lightning. Lasts 2 min.',
        cast: (ctx) => {
          ctx.weather.spawnGrowingCloud(ctx.player.position, false, 150);
        }
      },
      {
        id: 'atmospheric_instability',
        name: 'ATMOS INSTABILITY',
        key: 'X',
        range: '400M x 1200M SQUALL LINE',
        baseCd: 5.0,
        desc: 'Spawns giant squall line cloud behind player moving forward (10m/s, wind 120mph, rain 200mm/h). Powerful gust fronts shake camera.',
        cast: (ctx) => {
          // ONE-PIECE CINEMATIC: a full squall line - a wall of storm cells
          // rolling from behind the player, trailing its rain curtain.
          const cam = ctx.cameraController.camera;
          const dir = new THREE.Vector3();
          cam.getWorldDirection(dir);
          dir.y = 0;
          if (dir.lengthSq() < 0.001) dir.set(0, 0, 1);
          dir.normalize();
          const origin = ctx.player.position.clone().addScaledVector(dir, -130);
          ctx.weather.spawnSquallLine(origin, dir, 5, 14, 110);
          // Gust front reaches the player as the line passes
          setTimeout(() => {
            ctx.cameraController.addShake(ctx.player.position, 3.2, 2.5);
            ctx.sound.playGust(1.0);
          }, 900);
          setTimeout(() => {
            ctx.cameraController.addShake(ctx.player.position, 2.0, 2.0);
            ctx.sound.playGust(0.6);
          }, 1700);
        }
      },
      {
        id: 'hailstorm',
        name: 'HAILSTORM',
        key: 'C',
        range: '4 CLOUDS (280M SIZE)',
        baseCd: 5.0,
        desc: 'Spawns 4 large cumulonimbus clouds dumping golf-ball hailstones (50% shatter for 30% damage). Lasts 8 seconds.',
        cast: (ctx) => {
          // 4 towering cells, each dumping a live hail field (shatter
          // damage handled by the HailField physics on ground impact)
          for (let i = 0; i < 4; i++) {
            const pos = ctx.player.position.clone().add(new THREE.Vector3(
              (Math.random() - 0.5) * 120, 0, (Math.random() - 0.5) * 120));
            ctx.weather.spawnGrowingCloud(pos, true, 120, {
              startStage: 'cumulonimbus', maxStage: 'cumulonimbus',
              growthDuration: 2.0, lifeDuration: 14, particles: 900,
              rainOnSpawn: true,
            });
            ctx.weather.spawnHailstorm(pos, 95, 12);
          }
          ctx.cameraController.addShake(ctx.player.position, 1.2, 1.5);
        }
      },
      {
        id: 'derecho_swarm',
        name: 'DERECHO SWARM',
        key: 'V',
        range: '4 DERECHO WALLS (24M/S)',
        baseCd: 5.0,
        desc: 'Spawns 4 derecho storm walls from all 4 sides moving towards player at 24m/s (wind 240mph, 800m x 1600m). Passes through for 30s.',
        cast: (ctx) => {
          // ONE-PIECE CINEMATIC: 4 derecho walls closing on the arena from
          // all sides; each whooshes a gust front past the player as it hits.
          const p = ctx.player.position;
          ctx.cameraController.addShake(p, 3.0, 3.5);
          ctx.sound.playGust(1.1);
          for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
            const from = p.clone().add(new THREE.Vector3(
              Math.cos(angle) * 300, 0, Math.sin(angle) * 300));
            const dir = p.clone().sub(from).setY(0).normalize();
            ctx.weather.spawnSquallLine(from, dir, 4, 24, 100);
            const passDelay = (300 / 24) * 1000 + i * 120;
            setTimeout(() => {
              ctx.cameraController.addShake(ctx.player.position, 3.5, 2.5);
              ctx.sound.playGust(1.0);
            }, passDelay);
          }
        }
      },
      {
        id: 'tornado_destruction',
        name: 'TORNADO DESTRUCTION',
        key: 'B',
        range: '350M CLOUD (200 MPH TORNADO)',
        baseCd: 5.0,
        desc: 'Big supercell cloud swirls underbase to produce a 200 mph tornado that sucks enemies in and damages continuously for 10s.',
        cast: (ctx) => {
          const target = ctx.player.aimTarget;
          // ONE-PIECE CINEMATIC: rotating wall cloud under a supercell,
          // with the condensation funnel dropped below it.
          ctx.weather.spawnWallCloud(target, 70, 12, 0.55);
          ctx.weather.spawnGrowingCloud(target, true, 230, {
            startStage: 'cumulonimbus', maxStage: 'supercell',
            growthDuration: 3.0, lifeDuration: 14,
          });
          ctx.weather.createTornado(target, 9, 190, 220, 10.0);
          // visible swirling suction vortex at the ground
          ctx.explosions.vortex(target, 0x99ccff, 18.0, 9.5);
          ctx.cameraController.addShake(target, 2.5, 2.0);
        }
      },
      {
        id: 'hurricane_storm',
        name: 'HURRICANE STORM',
        key: 'F',
        range: '25 KM SCALE EYEWALL (350 MPH)',
        baseCd: 5.0,
        desc: '1s warmup (invincible). Spawns 25km swirling hurricane moving forward at 15m/s with eye in center and violent eyewall rainshaft mists.',
        cast: (ctx) => {
          ctx.player.buffs.invincible.active = true;
          ctx.player.buffs.invincible.timer = 1.0;

          setTimeout(() => {
            const eye = ctx.player.position.clone();
            // ONE-PIECE CINEMATIC: a full hurricane disc - a ring of orbiting
            // eyewall supercells around a calm eye + eyewall rain ring.
            ctx.weather.spawnHurricane(eye, 140, 18);
            ctx.cameraController.addShake(ctx.player.position, 5.0, 5.0);
            // colossal eyewall suction vortex at the eye
            ctx.explosions.vortex(eye, 0x88bbee, 42.0, 15.0);
            ctx.explosions.megaShockwave(eye, 220.0, 0x66aaff);
          }, 1000);
        }
      },
      {
        id: 'microburst_bomb',
        name: 'MICROBURST BOMB',
        key: 'G',
        range: '200M/S DOWNDRAFT SLAM',
        baseCd: 5.0,
        desc: 'Continuous microburst slamming down at 200 m/s for 10s. Rain wall expands rapidly knocking enemies away with intense wind camera shake.',
        cast: (ctx) => {
          // Staggered triple-downdraft triangle + expanding rain curtain
          const t = ctx.player.aimTarget;
          ctx.cameraController.addShake(t, 4.0, 2.5);
          ctx.weather.createMicroburst(t, 150, 10.0);
          const mk = (x, z) => new THREE.Vector3(t.x + x, 0, t.z + z);
          setTimeout(() => ctx.weather.createMicroburst(mk(70, 40), 120, 8.0), 400);
          setTimeout(() => ctx.weather.createMicroburst(mk(-70, 40), 120, 8.0), 800);
          ctx.weather.createRainshaft(t, 220, 160, 600);
        }
      },
      {
        id: 'nimbostratus_flooding',
        name: 'NIMBOSTRATUS FLOOD',
        key: 'N',
        range: 'STEADY RAIN + RISING WATER',
        baseCd: 5.0,
        desc: 'Large nimbostratus clouds producing steady rain. Rainwater rises on the ground, drowning enemies.',
        cast: (ctx) => {
          // Low, wide, flat nimbostratus deck over the arena + rising flood
          ctx.weather.startNimbostratusFlood(20.0);
          const p = ctx.player.position;
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            const r = 50 + i * 30;
            const off = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
            ctx.weather.spawnGrowingCloud(p.clone().add(off), false, 150, {
              altitude: 85, flat: 0.40,
              startStage: 'congestus', maxStage: 'congestus',
              growthDuration: 2.0, lifeDuration: 22, particles: 900,
              rainOnSpawn: i < 3,
            });
          }
          ctx.weather.createRainshaft(p, 300, 130, 800);
        }
      },
      {
        id: 'supercell_spawner',
        name: 'SUPERCELL SPAWNER',
        key: 'M',
        range: 'UI MATRIX SELECTION',
        baseCd: 5.0,
        desc: 'Interactive UI modal allows selecting: LP Supercell (300m, 2.5x faster CD), Normal Supercell (500m), or HP Supercell (700m, 2.5x slower CD).',
        cast: (ctx) => {
          ctx.openSupercellPicker();
        }
      },
      {
        id: 'storm_suppression',
        name: 'STORM SUPPRESSION',
        key: 'L',
        range: '15 RAPID CELLS (30S)',
        baseCd: 5.0,
        desc: 'Cloud cells spawn one by one growing rapidly to cumulonimbus until hitting 15 cells max. Duration 30s.',
        cast: (ctx) => {
          let count = 0;
          const cellTimer = setInterval(() => {
            count++;
            if (count > 15) {
              clearInterval(cellTimer);
              return;
            }
            const p = ctx.player.position.clone().add(new THREE.Vector3(
              (Math.random() - 0.5) * 160,
              0,
              (Math.random() - 0.5) * 160
            ));
            ctx.weather.spawnGrowingCloud(p, false, 100, {
              growthDuration: 4.0, lifeDuration: 32, particles: 750,
            });
          }, 800);
        }
      }
    ]
  }
};
