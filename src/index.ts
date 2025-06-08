import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.post('/identify', async (req: Request, res: Response) => {
  const { email, phoneNumber } = req.body;

  const contacts = await prisma.contact.findMany({
    where: {
      OR: [
        { email: email ?? undefined },
        { phoneNumber: phoneNumber ?? undefined },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });

  type Contact = {
    id: number;
    phoneNumber: string | null;
    email: string | null;
    linkedId: number | null;
    linkPrecedence: 'primary' | 'secondary';
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  };

  let primaryContact: Contact = contacts.find((c: Contact) => c.linkPrecedence === 'primary') ?? contacts[0];

  // Merge multiple primaries
  const allPrimaryContacts = contacts.filter((c: Contact) => c.linkPrecedence === 'primary');

  for (const contact of allPrimaryContacts) {
    if (contact.id !== primaryContact.id) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: {
          linkPrecedence: 'secondary',
          linkedId: primaryContact.id,
        },
      });
    }
  }

  const isDuplicate = contacts.some(
    (c: Contact) => c.email === email && c.phoneNumber === phoneNumber
  );

  if (!isDuplicate && (email || phoneNumber)) {
    await prisma.contact.create({
      data: {
        email,
        phoneNumber,
        linkPrecedence: 'secondary',
        linkedId: primaryContact.id,
        deletedAt: null,
      },
    });
  }

  // Refetch unified group
  const linkedContacts = await prisma.contact.findMany({
    where: {
      OR: [
        { id: primaryContact.id },
        { linkedId: primaryContact.id },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });

  const emails: string[] = Array.from(
    new Set(
      linkedContacts
        .map((c: Contact) => c.email)
        .filter((e: string | null): e is string => Boolean(e))
    )
  );

  const phoneNumbers: string[] = Array.from(
    new Set(
      linkedContacts
        .map((c: Contact) => c.phoneNumber)
        .filter((p: string | null): p is string => Boolean(p))
    )
  );

  const secondaryContactIds: number[] = linkedContacts
    .filter((c: Contact) => c.linkPrecedence === 'secondary')
    .map((c: Contact) => c.id);

  return res.status(200).json({
    contact: {
      primaryContactId: primaryContact.id,
      emails: [primaryContact.email!, ...emails.filter((e: string) => e !== primaryContact.email)],
      phoneNumbers: [primaryContact.phoneNumber!, ...phoneNumbers.filter((p: string) => p !== primaryContact.phoneNumber)],
      secondaryContactIds,
    },
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});