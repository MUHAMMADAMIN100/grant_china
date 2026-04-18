import Header from './components/Header';
import Hero from './components/Hero';
import Services from './components/Services';
import Advantages from './components/Advantages';
import ApplicationForm from './components/ApplicationForm';
import Contacts from './components/Contacts';
import Footer from './components/Footer';

export default function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Services />
        <Advantages />
        <ApplicationForm />
        <Contacts />
      </main>
      <Footer />
    </>
  );
}
