import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function seed() {
  // 1. 创建管理员账户
  const adminEmail = 'adminharry@icebreaker.pro';
  const adminPassword = 'admin123';
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  let admin;
  if (!existingAdmin) {
    admin = await prisma.user.create({
      data: { email: adminEmail, passwordHash, isAdmin: true },
    });
    console.log(`✓ Admin created: ${adminEmail}`);
  } else {
    admin = existingAdmin;
    console.log(`✓ Admin already exists: ${adminEmail}`);
  }

  // 2. 创建默认 SenderProfile
  const existingProfile = await prisma.senderProfile.findFirst({
    where: { userId: admin.id, isDefault: true },
  });
  if (!existingProfile) {
    await prisma.senderProfile.create({
      data: {
        userId: admin.id,
        name: 'Harry Xu',
        title: 'Founding Engineer',
        company: 'Icebreaker',
        role: 'Hiring Manager',
        signature: 'Best,\nHarry',
        isDefault: true,
      },
    });
    console.log('✓ Default sender profile created');
  }

  // 3. 导入 sample_candidates.csv
  const csvPath = process.cwd() + '/../sample_candidates.csv';
  if (fs.existsSync(csvPath)) {
    const csv = fs.readFileSync(csvPath, 'utf-8');
    const lines = csv.trim().split('\n');
    if (lines.length > 1) {
      // 检查是否已有 Campaign
      let campaign = await prisma.campaign.findFirst({
        where: { userId: admin.id, name: 'Sample Outreach' },
      });
      if (!campaign) {
        campaign = await prisma.campaign.create({
          data: {
            userId: admin.id,
            name: 'Sample Outreach',
            jobTitle: 'Senior Engineer',
            style: 'PROFESSIONAL',
            language: 'English',
            emailCount: 1,
            status: 'DRAFT',
          },
        });
        console.log('✓ Sample campaign created');
      }

      // Header: name,email,background
      const header = lines[0];
      let importedCount = 0;
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Simple CSV parse (no quoted commas in this data)
        const parts = line.split(',');
        const name = parts[0]?.trim();
        const email = parts[1]?.trim();
        const background = parts.slice(2).join(',').trim();

        const existingCandidate = await prisma.candidate.findFirst({
          where: { campaignId: campaign.id, email },
        });
        if (!existingCandidate) {
          await prisma.candidate.create({
            data: {
              campaignId: campaign.id,
              name,
              email,
              rawText: background || line,
              source: 'CSV_IMPORT',
              status: 'PENDING',
            },
          });
          importedCount++;
        }
      }
      console.log(`✓ ${importedCount} candidates imported to campaign`);
    }
  } else {
    console.log('⚠ sample_candidates.csv not found, skipping candidate import');
  }
}

seed()
  .then(() => { console.log('\nSeed complete.'); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
