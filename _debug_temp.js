const mongoose = require('mongoose');

mongoose.connect('mongodb+srv://focodigitaldb:Mayita2025@focodigitalmongodb.xrwsc5h.mongodb.net/viatika?retryWrites=true&w=majority')
.then(async () => {
  const db = mongoose.connection.db;
  const user = await db.collection('users').findOne({ email: 'jose.novoa@tecdidata.com' });
  
  if (user) {
    console.log('--- USER DATA ---');
    console.log('ID:', user._id);
    console.log('Email:', user.email);
    console.log('ClientId:', user.clientId);
    
    const notifs = await db.collection('notifications').find({ userId: user._id }).sort({createdAt: -1}).limit(5).toArray();
    console.log('\n--- NOTIFICATIONS FOR THIS USER ---');
    if (notifs.length > 0) {
      notifs.forEach(n => {
        console.log(`[${n.createdAt}] Titulo: ${n.title} | Mensaje: ${n.message} | isRead: ${n.isRead}`);
      });
    } else {
      console.log('No notifications found for this user _id.');
      
      // Try string search just in case
      const notifsStr = await db.collection('notifications').find({ userId: user._id.toString() }).toArray();
      console.log(`Found ${notifsStr.length} notifications with string userId.`);
    }
  } else {
    console.log('User jose.novoa@tecdidata.com not found.');
  }
  
  mongoose.disconnect();
})
.catch(console.error);
